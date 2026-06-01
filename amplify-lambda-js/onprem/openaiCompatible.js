//Copyright (c) 2024 Vanderbilt University
//Authors: Jules White, Allen Karns, Karely Rodriguez, Max Moundas

import axios from 'axios';
import { getLogger } from "../common/logging.js";
import { logCriticalError } from "../common/criticalLogger.js";
import { trace } from "../common/trace.js";
import { sendErrorMessage, sendStateEventToStream } from "../common/streams.js";
import {
    additionalImageInstruction,
    doesNotSupportImagesInstructions,
    extractKey,
    getImageBase64Content
} from "../datasource/datasources.js";
import { detectContextOverflow, shouldCriticalLogOverflow } from "../llm/contextOverflow.js";
import { getLLMConfig } from "../common/secrets.js";

const logger = getLogger("local-llm");

const DEFAULT_TIMEOUT_MS = 180000;

const getEnv = (name, fallback = "") => {
    const value = process.env[name];
    return value === undefined || value === null ? fallback : value.trim();
};

const getConfigValue = (secretConfig, envName, secretKeys, fallback = "") => {
    const envValue = getEnv(envName);
    if (envValue !== "") {
        return envValue;
    }

    for (const key of secretKeys) {
        const value = secretConfig?.[key];
        if (value !== undefined && value !== null && `${value}`.trim() !== "") {
            return value;
        }
    }

    return fallback;
};

const normalizeChatCompletionsUrl = (baseUrl) => {
    if (!baseUrl) {
        throw new Error("LOCAL_LLM_BASE_URL is required for Local/OnPrem LLM provider");
    }

    const trimmed = typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : "";
    if (trimmed.endsWith("/chat/completions")) {
        return trimmed;
    }

    return `${trimmed}/chat/completions`;
};

const getEndpointSecretConfig = async (model) => {
    const modelId = model?.id || "local-llm";
    try {
        return await getLLMConfig(modelId, model?.provider || "Local");
    } catch (error) {
        logger.warn(`Local LLM endpoint config not found in LLM endpoints secret for model ${modelId}: ${error.message}`);
        return {};
    }
};

const getLocalConfig = async (model) => {
    const envBaseUrl = getEnv("LOCAL_LLM_BASE_URL");
    const secretConfig = envBaseUrl ? {} : await getEndpointSecretConfig(model);
    const rawBaseUrl = getConfigValue(secretConfig, "LOCAL_LLM_BASE_URL", ["baseUrl", "base_url", "url"]);
    const baseUrl = typeof rawBaseUrl === "string" ? rawBaseUrl.trim() : rawBaseUrl;
    const url = normalizeChatCompletionsUrl(baseUrl);
    const rawApiKey = getConfigValue(secretConfig, "LOCAL_LLM_API_KEY", ["apiKey", "api_key", "key"]);
    const apiKey = typeof rawApiKey === "string" ? rawApiKey.trim() : rawApiKey;
    const timeoutMs = Number(getConfigValue(secretConfig, "LOCAL_LLM_TIMEOUT_MS", ["timeoutMs", "timeout_ms"], DEFAULT_TIMEOUT_MS)) || DEFAULT_TIMEOUT_MS;
    const providerName = getConfigValue(secretConfig, "LOCAL_LLM_PROVIDER", ["provider"], model?.provider || "Local");
    const modelId = getConfigValue(secretConfig, "LOCAL_LLM_MODEL", ["model", "modelId", "model_id"], model?.id || "local-llm");
    const authHeader = getConfigValue(secretConfig, "LOCAL_LLM_AUTH_HEADER", ["authHeader", "auth_header"], "Authorization");
    const authScheme = getConfigValue(secretConfig, "LOCAL_LLM_AUTH_SCHEME", ["authScheme", "auth_scheme"], "Bearer");
    const includeUsage = `${getConfigValue(secretConfig, "LOCAL_LLM_INCLUDE_USAGE", ["includeUsage", "include_usage"], "true")}`.toLowerCase() !== "false";

    return { url, apiKey, timeoutMs, providerName, modelId, authHeader, authScheme, includeUsage };
};

const getAuthHeaders = (localConfig) => {
    const apiKey = localConfig.apiKey;
    if (!apiKey) {
        return {};
    }

    const headerName = localConfig.authHeader || "Authorization";
    const authScheme = localConfig.authScheme || "";
    const headerValue = headerName.toLowerCase() === "authorization" && authScheme
        ? `${authScheme} ${apiKey}`
        : apiKey;

    return { [headerName]: headerValue };
};

const cleanMessages = (messages = []) => {
    return messages.map(msg => ({
        role: msg.role,
        content: msg.content ?? "",
        ...(msg.name && { name: msg.name }),
        ...(msg.function_call && { function_call: msg.function_call }),
        ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
        ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id })
    }));
};

const appendTextToMessage = (message, text) => {
    if (!message) {
        return;
    }

    if (typeof message.content === "string") {
        message.content += text;
        return;
    }

    if (Array.isArray(message.content)) {
        message.content.push({ type: "text", text });
    }
};

const applySystemPrompt = (messages, model) => {
    if (!model?.systemPrompt || messages.length === 0) {
        return messages;
    }

    const firstSystemMessage = messages.find(message => message.role === "system");
    if (firstSystemMessage) {
        appendTextToMessage(firstSystemMessage, `\n${model.systemPrompt}`);
    } else {
        messages.unshift({ role: "system", content: model.systemPrompt });
    }

    return messages;
};

const adaptSystemMessages = (messages, model) => {
    if (model?.supportsSystemPrompts) {
        return messages;
    }

    return messages.map(message => message.role === "system"
        ? { ...message, role: "user" }
        : message
    );
};

const buildRequestData = async (chatBody, writable) => {
    const body = { ...chatBody };
    const options = { ...body.options };
    delete body.options;

    const model = options.model || {};
    const localConfig = await getLocalConfig(model);
    const shouldStream = body.stream !== false;
    let messages = cleanMessages(body.messages || []);

    messages = applySystemPrompt(messages, model);
    messages = adaptSystemMessages(messages, model);

    if (!options.dataSourceOptions?.disableDataSources) {
        messages = await includeImageSources(body.imageSources, messages, model, writable);
    }

    const data = {
        ...body,
        messages,
        model: localConfig.modelId,
        stream: shouldStream,
        max_tokens: body.max_tokens || model.outputTokenLimit || 2000,
        temperature: body.temperature ?? options.temperature ?? 1.0
    };

    if (model.outputTokenLimit && data.max_tokens > model.outputTokenLimit) {
        data.max_tokens = model.outputTokenLimit;
    }

    const tools = body.tools || options.tools;
    if (tools && tools.length > 0) {
        data.tools = tools;
        data.tool_choice = body.tool_choice || options.tool_choice || "auto";
    } else if (body.tool_choice || options.tool_choice) {
        data.tool_choice = body.tool_choice || options.tool_choice;
    }

    if (body.response_format) {
        data.response_format = body.response_format;
    }

    if (shouldStream && localConfig.includeUsage) {
        data.stream_options = { include_usage: true };
    }

    delete data.imageSources;
    delete data.videoSources;
    delete data.mcpClientSide;
    delete data.webSearchEnabled;

    return { data, options, model, localConfig };
};

const cloneWithoutOptionalOpenAIFields = (data) => {
    const retryData = { ...data };
    delete retryData.stream_options;
    return retryData;
};

const cloneWithoutTools = (data) => {
    const retryData = cloneWithoutOptionalOpenAIFields(data);
    delete retryData.tools;
    delete retryData.tool_choice;
    return retryData;
};

const shouldRetryWithoutOptionalFields = (error, data, retriedOptionalFields) => {
    const status = error.response?.status;
    return !retriedOptionalFields && data.stream_options && [400, 404, 422].includes(status);
};

const shouldRetryWithoutTools = (error, data, retriedWithoutTools) => {
    const status = error.response?.status;
    return !retriedWithoutTools && data.tools && data.tools.length > 0 && [400, 404, 422].includes(status);
};

const readAxiosErrorData = async (error) => {
    const responseData = error.response?.data;
    if (!responseData) {
        return null;
    }

    if (typeof responseData === "string") {
        return responseData;
    }

    if (!responseData.readable) {
        return responseData;
    }

    return await new Promise((resolve) => {
        let errorData = "";
        let settled = false;

        const settle = () => {
            if (!settled) {
                settled = true;
                resolve(errorData || null);
            }
        };

        responseData.on("data", chunk => {
            errorData += chunk.toString();
        });
        responseData.on("end", settle);
        responseData.on("error", settle);
        setTimeout(settle, 5000);
    });
};

const attachParsedErrorMessage = (error, errorDetails) => {
    if (!errorDetails) {
        return;
    }

    if (typeof errorDetails === "string") {
        try {
            const parsed = JSON.parse(errorDetails);
            error._parsedErrorMessage = parsed.error?.message || parsed.message || errorDetails;
        } catch {
            error._parsedErrorMessage = errorDetails;
        }
        return;
    }

    error._parsedErrorMessage = errorDetails.error?.message || errorDetails.message || JSON.stringify(errorDetails);
};

const getProviderStatusCode = (error) => {
    if (error.response?.status) {
        return error.response.status;
    }

    if (["ECONNABORTED", "ETIMEDOUT"].includes(error.code)) {
        return 504;
    }

    if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET"].includes(error.code)) {
        return 503;
    }

    return 502;
};

const getSafeProviderErrorMessage = (error) => {
    if (!error.response && error.code) {
        return `Connection failure (${error.code})`;
    }

    return error._parsedErrorMessage || error.message || "Unknown local LLM error";
};

const writeProviderResponse = async (response, writable, shouldStream) => {
    if (shouldStream) {
        await new Promise((resolve, reject) => {
            response.data.on("error", reject);
            response.data.on("end", resolve);
            response.data.pipe(writable, { end: false });
        });

        if (!writable.writableEnded) {
            writable.end();
        }
        return;
    }

    writable.write(`data: ${JSON.stringify(response.data)}\n\n`);
    writable.end();
};

const invokeLocalProvider = async (url, data, headers, timeoutMs, writable, retryState = {}) => {
    try {
        logger.info("Invoking local LLM provider", {
            provider: "Local",
            model: data.model,
            stream: data.stream,
            hasTools: !!(data.tools && data.tools.length > 0),
            hasAuth: Object.keys(headers).some(key => key.toLowerCase() !== "content-type"),
            endpointConfigured: true
        });

        const response = await axios({
            data,
            headers,
            method: "post",
            url,
            timeout: timeoutMs,
            responseType: data.stream ? "stream" : "json"
        });

        await writeProviderResponse(response, writable, data.stream);
    } catch (error) {
        const errorDetails = await readAxiosErrorData(error);
        attachParsedErrorMessage(error, errorDetails);

        if (shouldRetryWithoutOptionalFields(error, data, retryState.retriedOptionalFields)) {
            logger.warn("Local LLM endpoint rejected optional OpenAI stream fields; retrying without them");
            return invokeLocalProvider(url, cloneWithoutOptionalOpenAIFields(data), headers, timeoutMs, writable, {
                ...retryState,
                retriedOptionalFields: true
            });
        }

        if (shouldRetryWithoutTools(error, data, retryState.retriedWithoutTools)) {
            logger.warn("Local LLM endpoint rejected tool fields; retrying without tools");
            return invokeLocalProvider(url, cloneWithoutTools(data), headers, timeoutMs, writable, {
                ...retryState,
                retriedWithoutTools: true,
                retriedOptionalFields: true
            });
        }

        throw error;
    }
};

export const chatLocalOpenAICompatible = async (chatBody, writable) => {
    let data = null;
    let options = {};
    let model = {};
    let localConfig = {};

    try {
        const built = await buildRequestData(chatBody, writable);
        data = built.data;
        options = built.options;
        model = built.model;
        localConfig = built.localConfig;

        const headers = {
            "Content-Type": "application/json",
            ...getAuthHeaders(localConfig)
        };

        const sanitizedTraceData = { ...data };
        delete sanitizedTraceData.messages;
        trace(options.requestId, ["chat", "local"], {
            provider: localConfig.providerName,
            modelId: data.model,
            endpointConfigured: true,
            data: sanitizedTraceData
        });

        await invokeLocalProvider(localConfig.url, data, headers, localConfig.timeoutMs, writable);
    } catch (error) {
        const overflowInfo = detectContextOverflow(error);
        const requestId = options?.requestId || "unknown";
        const shouldLog = !overflowInfo.isOverflow || shouldCriticalLogOverflow(requestId);
        const statusCode = getProviderStatusCode(error);
        const apiErrorMessage = getSafeProviderErrorMessage(error);

        logger.error("Error invoking local LLM provider", {
            provider: localConfig.providerName || model?.provider || "Local",
            modelId: data?.model || model?.id || "unknown",
            requestId,
            statusCode,
            errorCode: error.code || error.name || "N/A",
            message: apiErrorMessage
        });

        if (shouldLog && process.env.LOCAL_DEVELOPMENT !== "true") {
            const sanitizedRequest = data ? { ...data } : {};
            delete sanitizedRequest.messages;

            logCriticalError({
                functionName: "chatLocalOpenAICompatible",
                errorType: overflowInfo.isOverflow ? "ContextOverflowRecoveryFailed" : "LocalLLMProviderFailure",
                errorMessage: `Local LLM provider failed: ${apiErrorMessage}`,
                currentUser: options?.user || options?.accountId || "unknown",
                severity: "HIGH",
                stackTrace: error.stack || "",
                context: {
                    requestId,
                    modelId: data?.model || model?.id || "unknown",
                    provider: localConfig.providerName || "Local",
                    httpStatus: error.response?.status || "N/A",
                    httpStatusText: error.response?.statusText || "N/A",
                    errorCode: error.code || error.name || "N/A",
                    endpointConfigured: !!localConfig.url,
                    requestConfig: sanitizedRequest,
                    ...(overflowInfo.isOverflow && {
                        overflowDetails: {
                            requested: overflowInfo.requested,
                            limit: overflowInfo.limit,
                            overflow: overflowInfo.overflow
                        }
                    })
                }
            }).catch(err => logger.error("Failed to log local LLM critical error:", err));

            error.criticalErrorLogged = true;
        } else if (overflowInfo.isOverflow) {
            logger.info(`Context overflow detected for local LLM (${overflowInfo.overflow || "unknown"} tokens over), allowing recovery attempt`);
            error.isContextOverflow = true;
            error.overflowInfo = overflowInfo;
        }

        if (!overflowInfo.isOverflow && writable?.writable && !writable.writableEnded) {
            sendErrorMessage(writable, statusCode, error.response?.statusText || error.code);
        }

        throw error;
    }
};

async function includeImageSources(dataSources, messages, model, responseStream) {
    if (!dataSources || dataSources.length === 0) {
        return messages;
    }

    const lastMessage = messages[messages.length - 1];

    if (!model.supportsImages) {
        appendTextToMessage(lastMessage, doesNotSupportImagesInstructions(model.name || model.id || "this model"));
        return messages;
    }

    sendStateEventToStream(responseStream, {
        sources: {
            images: {
                sources: dataSources.map(ds => ({ ...ds, contentKey: extractKey(ds.id) }))
            }
        }
    });

    const imageMessageContent = [];
    const retrievedImages = [];

    for (const ds of dataSources) {
        const encodedImage = await getImageBase64Content(ds);
        if (encodedImage) {
            retrievedImages.push({ ...ds, contentKey: extractKey(ds.id) });
            imageMessageContent.push({
                type: "image_url",
                image_url: {
                    url: `data:${ds.type || "image/png"};base64,${encodedImage}`,
                    detail: "high"
                }
            });
        }
    }

    if (retrievedImages.length > 0) {
        sendStateEventToStream(responseStream, {
            sources: { images: { sources: retrievedImages } }
        });
    }

    lastMessage.content = [
        { type: "text", text: additionalImageInstruction },
        ...imageMessageContent,
        { type: "text", text: typeof lastMessage.content === "string" ? lastMessage.content : JSON.stringify(lastMessage.content) }
    ];

    return messages;
}
