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

	function clearAuthCallbackUrl(url) {
		url.hash = "";
		[
			"access_token",
			"refresh_token",
			"expires_in",
			"token_type",
			"type",
			"error",
			"error_code",
			"error_description"
		].forEach(function (key) {
			url.searchParams.delete(key);
		});
		window.history.replaceState(
			null,
			document.title,
			url.pathname + url.search
		);
	}

	async function getCurrentUser(accessToken) {
		var response = await fetch(configuration.url + "/auth/v1/user", {
			method: "GET",
			headers: {
				apikey: configuration.anonKey,
				Authorization: "Bearer " + accessToken
			}
		});
		var responseBody = await response.text();
		var parsedBody = parseResponse(responseBody);
		if (!response.ok) {
			var error = new Error(
				"Supabase user lookup failed with status " + response.status
			);
			error.status = response.status;
			error.details = parsedBody;
			throw error;
		}
		return parsedBody;
	}

	async function getAuthCallbackSession() {
		var url = new URL(window.location.href);
		var hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
		var getParameter = function (key) {
			return hashParams.get(key) || url.searchParams.get(key);
		};
		var errorDescription = getParameter("error_description");
		var errorCode = getParameter("error_code") || getParameter("error");
		if (errorDescription || errorCode) {
			clearAuthCallbackUrl(url);
			throw new Error(errorDescription || errorCode);
		}

		var accessToken = getParameter("access_token");
		var refreshToken = getParameter("refresh_token");
		if (!accessToken || !refreshToken) {
			return null;
		}

		var expiresIn = Number(getParameter("expires_in"));
		var session = saveSession({
			access_token: accessToken,
			refresh_token: refreshToken,
			expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ?
				expiresIn : 3600,
			token_type: getParameter("token_type") || "bearer"
		});
		try {
			session.user = await getCurrentUser(accessToken);
			return saveSession(session);
		} finally {
			clearAuthCallbackUrl(url);
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
				anonKey: options.anonKey,
				emailRedirectTo: options.emailRedirectTo ||
					window.location.origin
			};
		},

		getSession: async function () {
			var callbackSession = await getAuthCallbackSession();
			var session = callbackSession || readSession();
			if (!session || !session.refresh_token) {
				return null;
			}
			if (session.expires_at > Math.floor(Date.now() / 1000) + 60) {
				if (!session.user && session.access_token) {
					session.user = await getCurrentUser(session.access_token);
					saveSession(session);
				}
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
			var path = "signup?redirect_to=" +
				encodeURIComponent(configuration.emailRedirectTo);
			var result = await authRequest(path, {
				email: email,
				password: password
			});

			if (result && result.access_token && result.refresh_token) {
				saveSession(result);
			}
			return result;
		},

		resendSignupConfirmation: async function (email) {
			return authRequest("resend", {
				type: "signup",
				email: email,
				options: {
					emailRedirectTo: configuration.emailRedirectTo
				}
			});
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
