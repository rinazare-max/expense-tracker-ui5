sap.ui.define([], function () {
	"use strict";

	var configuration;
	var sessionKey = "expenseTrack.auth.session";

	function parseResponse(responseBody) {
		if (!responseBody) {
			return null;
		}

		try {
			return JSON.parse(responseBody);
		} catch (error) {
			return responseBody;
		}
	}

	function saveSession(session) {
		session.expires_at = session.expires_at ||
			Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
		sessionStorage.setItem(sessionKey, JSON.stringify(session));
		return session;
	}

	function readSession() {
		var storedSession = sessionStorage.getItem(sessionKey);
		if (!storedSession) {
			return null;
		}

		try {
			return JSON.parse(storedSession);
		} catch (error) {
			console.warn("Discarding an invalid stored Supabase session.", error);
			sessionStorage.removeItem(sessionKey);
			return null;
		}
	}

	async function authRequest(path, body, accessToken) {
		if (!configuration) {
			throw new Error("AuthService must be configured before authentication.");
		}

		var response = await fetch(configuration.url + "/auth/v1/" + path, {
			method: "POST",
			headers: {
				apikey: configuration.anonKey,
				Authorization: "Bearer " + (accessToken || configuration.anonKey),
				"Content-Type": "application/json"
			},
			body: JSON.stringify(body || {})
		});
		var responseBody = await response.text();
		var parsedBody = parseResponse(responseBody);

		if (!response.ok) {
			var error = new Error(
				"Supabase authentication failed with status " + response.status
			);
			error.status = response.status;
			error.details = parsedBody;
			throw error;
		}

		return parsedBody;
	}

	return {
		configure: function (options) {
			if (!options || typeof options.url !== "string" || !options.url.trim()) {
				throw new Error("AuthService requires a Supabase project URL.");
			}
			if (typeof options.anonKey !== "string" || !options.anonKey.trim()) {
				throw new Error("AuthService requires a Supabase public API key.");
			}

			configuration = {
				url: options.url.replace(/\/+$/, ""),
				anonKey: options.anonKey
			};
		},

		getSession: async function () {
			var session = readSession();
			if (!session || !session.refresh_token) {
				return null;
			}
			if (session.expires_at > Math.floor(Date.now() / 1000) + 60) {
				return session;
			}

			return this.refreshSession(session.refresh_token);
		},

		getAccessToken: async function () {
			var session = await this.getSession();
			return session ? session.access_token : null;
		},

		signIn: async function (email, password) {
			var session = await authRequest("token?grant_type=password", {
				email: email,
				password: password
			});
			return saveSession(session);
		},

		signUp: async function (email, password) {
			var result = await authRequest("signup", {
				email: email,
				password: password
			});

			if (result && result.access_token && result.refresh_token) {
				saveSession(result);
			}
			return result;
		},

		refreshSession: async function (refreshToken) {
			var session = await authRequest("token?grant_type=refresh_token", {
				refresh_token: refreshToken
			});
			return saveSession(session);
		},

		signOut: async function () {
			var session = readSession();
			if (!session) {
				return;
			}

			try {
				await authRequest("logout", {}, session.access_token);
			} finally {
				sessionStorage.removeItem(sessionKey);
			}
		}
	};
});
