sap.ui.define([], function () {
	"use strict";

	var configuration;
	var accessTokenProvider;

	function createServiceError(response, responseBody) {
		var error = new Error(
			"Supabase request failed with status " + response.status +
			(response.statusText ? " " + response.statusText : "")
		);
		error.status = response.status;
		error.details = responseBody;
		return error;
	}

	return {
		configure: function (options) {
			if (!options || typeof options.url !== "string" || !options.url.trim()) {
				throw new Error("SupabaseService requires a Supabase project URL.");
			}
			if (typeof options.anonKey !== "string" || !options.anonKey.trim()) {
				throw new Error("SupabaseService requires a Supabase anon key.");
			}

			configuration = {
				url: options.url.replace(/\/+$/, ""),
				anonKey: options.anonKey
			};
		},

		setAccessTokenProvider: function (provider) {
			if (typeof provider !== "function") {
				throw new Error("SupabaseService requires an access-token provider.");
			}
			accessTokenProvider = provider;
		},

		request: async function (resourcePath, options) {
			if (!configuration) {
				throw new Error("SupabaseService must be configured before making requests.");
			}
			if (typeof resourcePath !== "string" || !resourcePath.trim()) {
				throw new Error("A Supabase REST resource path is required.");
			}

			var requestOptions = options || {};
			var accessToken = accessTokenProvider ? await accessTokenProvider() : null;
			if (accessTokenProvider && !accessToken) {
				throw new Error("Sign in is required to access expense data.");
			}

			var headers = Object.assign({}, requestOptions.headers, {
				apikey: configuration.anonKey
			});
			if (!headers.Authorization && !headers.authorization) {
				headers.Authorization = "Bearer " + (accessToken || configuration.anonKey);
			}
			var requestInit = {
				method: requestOptions.method || "GET",
				headers: headers
			};

			if (requestOptions.body !== undefined) {
				headers["Content-Type"] = "application/json";
				requestInit.body = JSON.stringify(requestOptions.body);
			}

			var normalizedPath = resourcePath.replace(/^\/+/, "");
			var response = await fetch(
				configuration.url + "/rest/v1/" + normalizedPath,
				requestInit
			);
			var responseBody = await response.text();

			if (!response.ok) {
				throw createServiceError(response, responseBody);
			}
			if (!responseBody) {
				return null;
			}

			try {
				return JSON.parse(responseBody);
			} catch (error) {
				return responseBody;
			}
		}
	};
});
