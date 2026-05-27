exports.handler = async (event) => {
    console.log("PreTokenGeneration trigger invoked with event: " + JSON.stringify(event, null, 2));

    // Ensure we are using Version 2 of the trigger schema (supporting Access Token customization)
    if (event.version === "2") {
        const userAttributes = event.request?.userAttributes || {};
        const email = userAttributes.email;

        if (email) {
            // Initialize response structure if not present to avoid wiping other parameters
            event.response = event.response || {};
            event.response.claimsAndScopeOverrideDetails = event.response.claimsAndScopeOverrideDetails || {};
            event.response.claimsAndScopeOverrideDetails.accessTokenGeneration = event.response.claimsAndScopeOverrideDetails.accessTokenGeneration || {};
            event.response.claimsAndScopeOverrideDetails.accessTokenGeneration.claimsToAddOrOverride = event.response.claimsAndScopeOverrideDetails.accessTokenGeneration.claimsToAddOrOverride || {};

            // Add email claim to access token
            event.response.claimsAndScopeOverrideDetails.accessTokenGeneration.claimsToAddOrOverride.email = email;

            // Add legacy immutable_id claim for backward compatibility with Python backend and existing checks
            event.response.claimsAndScopeOverrideDetails.accessTokenGeneration.claimsToAddOrOverride.immutable_id = email;

            console.log(`Successfully added email and immutable_id claims to Access Token: ${email}`);
        } else {
            console.warn("No email found in user attributes.");
        }
    } else {
        console.warn(`PreTokenGeneration V1 trigger cannot modify Access Tokens. Event version is ${event.version}. Please ensure Cognito is configured to trigger this function with Version 2.`);
    }

    return event;
};

