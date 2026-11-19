sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/core/Fragment",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/ui/core/library",
	"sap/ui/core/format/NumberFormat",
	"expenseTrack/service/AuthService",
	"expenseTrack/service/SupabaseService"
], function (
	Controller,
	JSONModel,
	Fragment,
	MessageBox,
	MessageToast,
	CoreLibrary,
	NumberFormat,
	AuthService,
	SupabaseService
) {
	"use strict";

	var ValueState = CoreLibrary.ValueState;

	return Controller.extend("expenseTrack.controller.Main", {
		onInit: function () {
			this._totalFormatter = NumberFormat.getFloatInstance({
				minFractionDigits: 2,
				maxFractionDigits: 2
			});
			this.getView().setModel(new JSONModel({
				busy: false,
				authenticated: false,
				userEmail: "",
				userInitials: "",
				dateFrom: "",
				dateTo: "",
				appliedDateFrom: "",
				appliedDateTo: "",
				totalExpense: this._totalFormatter.format(0),
				monthExpense: this._totalFormatter.format(0),
				transactionCount: "0",
				averageExpense: this._totalFormatter.format(0),
				currentMonthLabel: new Date().toLocaleDateString(undefined, {
					month: "long",
					year: "numeric"
				}),
				visibleTransactionLabel: ""
			}), "viewState");
			this.getView().setModel(new JSONModel({
				allItems: [],
				items: []
			}), "expenses");

			this._applyExpenseDateFilter();
			this._initializeAuth();
		},

		_initializeAuth: async function () {
			try {
				var configuration = this.getOwnerComponent().getManifestEntry(
					"/sap.app/dataSources/supabase"
				);
				var serviceConfiguration = {
					url: configuration && configuration.uri,
					anonKey: configuration && configuration.settings &&
						configuration.settings.anonKey
				};
				AuthService.configure(serviceConfiguration);
				SupabaseService.configure(serviceConfiguration);
				SupabaseService.setAccessTokenProvider(
					this._getAccessToken.bind(this)
				);

				var session = await AuthService.getSession();
				if (session) {
					this._setAuthenticated(session);
					await this._loadExpenses();
				} else {
					await this._openAuthDialog("signIn");
				}
			} catch (error) {
				console.error("Failed to initialize Supabase authentication.", error);
				MessageBox.error(
					this.getView().getModel("i18n").getResourceBundle()
						.getText("authInitializeError"),
					{ details: this._getErrorDetails(error) }
				);
			}
		},

		_getAccessToken: async function () {
			var accessToken = await AuthService.getAccessToken();
			if (!accessToken && !this._isExiting) {
				this._setAuthenticated(null);
				this._openAuthDialog("signIn");
			}
			return accessToken;
		},

		_setAuthenticated: function (session) {
			var viewState = this.getView().getModel("viewState");
			var userEmail = session && session.user && session.user.email || "";
			viewState.setProperty("/authenticated", Boolean(session));
			viewState.setProperty("/userEmail", userEmail);
			viewState.setProperty("/userInitials", this._getUserInitials(userEmail));
			if (!session) {
				viewState.setProperty("/dateFrom", "");
				viewState.setProperty("/dateTo", "");
				viewState.setProperty("/appliedDateFrom", "");
				viewState.setProperty("/appliedDateTo", "");
				["expenseDateFromFilter", "expenseDateToFilter"].forEach(function (id) {
					var datePicker = this.byId(id);
					if (datePicker) {
						datePicker.setValueState(ValueState.None);
						datePicker.setValueStateText("");
					}
				}, this);
				var expensesModel = this.getView().getModel("expenses");
				expensesModel.setProperty("/allItems", []);
				expensesModel.setProperty("/items", []);
				this._applyExpenseDateFilter();
			}
		},

		_openAuthDialog: async function (mode) {
			try {
				if (!this._authDialog) {
					this._authDialog = await Fragment.load({
						id: this.getView().getId(),
						name: "expenseTrack.fragment.AuthDialog",
						controller: this
					});
					this._authDialog.addStyleClass("premiumDialog");
					this.getView().addDependent(this._authDialog);
				}

				var model = this._authDialog.getModel("authForm");
				var email = model ? model.getProperty("/email") : "";
				this._setAuthDialogMode(mode, email);
				this._authDialog.open();
			} catch (error) {
				console.error("Failed to open the authentication dialog.", error);
				MessageBox.error(
					this.getView().getModel("i18n").getResourceBundle()
						.getText("authDialogError"),
					{ details: this._getErrorDetails(error) }
				);
			}
		},

		_setAuthDialogMode: function (mode, email) {
			var bundle = this.getView().getModel("i18n").getResourceBundle();
			var isSignUp = mode === "signUp";
			this._authDialog.setModel(new JSONModel({
				mode: mode,
				email: email || "",
				password: "",
				dialogTitle: bundle.getText(isSignUp ? "signUpTitle" : "signInTitle"),
				submitLabel: bundle.getText(isSignUp ? "signUpButton" : "signInButton"),
				toggleLabel: bundle.getText(isSignUp ? "switchToSignIn" : "switchToSignUp")
			}), "authForm");
		},

		onToggleAuthMode: function () {
			var form = this._authDialog.getModel("authForm");
			this._setAuthDialogMode(
				form.getProperty("/mode") === "signUp" ? "signIn" : "signUp",
				form.getProperty("/email")
			);
		},

		onSubmitAuth: async function () {
			var dialog = this._authDialog;
			var form = dialog.getModel("authForm").getData();
			var email = form.email.trim();
			var bundle = this.getView().getModel("i18n").getResourceBundle();
			if (!email || !form.password) {
				MessageBox.error(bundle.getText("authFieldsRequired"));
				return;
			}

			dialog.setBusy(true);
			try {
				var session;
				if (form.mode === "signUp") {
					session = await AuthService.signUp(email, form.password);
					if (!session || !session.access_token) {
						this._setAuthDialogMode("signIn", email);
						MessageBox.information(bundle.getText("authConfirmationSent"));
						return;
					}
				} else {
					session = await AuthService.signIn(email, form.password);
				}

				this._setAuthenticated(session);
				dialog.close();
				await this._loadExpenses();
			} catch (error) {
				console.error("Supabase authentication failed.", error);
				MessageBox.error(
					bundle.getText("authRequestError"),
					{ details: this._getErrorDetails(error) }
				);
			} finally {
				dialog.setBusy(false);
			}
		},

		onSignOut: async function () {
			try {
				await AuthService.signOut();
			} catch (error) {
				console.error("Failed to sign out from Supabase.", error);
				MessageBox.error(
					this.getView().getModel("i18n").getResourceBundle()
						.getText("authSignOutError"),
					{ details: this._getErrorDetails(error) }
				);
			}

			this._setAuthenticated(null);
			this._openAuthDialog("signIn");
		},

		onOpenSignIn: function () {
			this._openAuthDialog("signIn");
		},

		_loadExpenses: async function () {
			var view = this.getView();
			var viewState = view.getModel("viewState");
			viewState.setProperty("/busy", true);

			try {
				var expenses = await SupabaseService.request("expenseTrack");
				if (!Array.isArray(expenses)) {
					throw new Error("Supabase returned an unexpected expense response.");
				}
				view.getModel("expenses").setProperty("/allItems", expenses);
				this._applyExpenseDateFilter();
			} catch (error) {
				if (!this._isExiting) {
					console.error("Failed to load expenses from Supabase.", error);
					MessageBox.error(
						view.getModel("i18n").getResourceBundle().getText("expenseLoadError"),
						{ details: this._getErrorDetails(error) }
					);
				}
			} finally {
				if (!this._isExiting) {
					viewState.setProperty("/busy", false);
				}
			}
		},

		onDateRangeChange: function (event) {
			var changedPicker = event.getSource();
			var fromPicker = this.byId("expenseDateFromFilter");
			var toPicker = this.byId("expenseDateToFilter");
			var bundle = this.getView().getModel("i18n").getResourceBundle();
			[fromPicker, toPicker].forEach(function (datePicker) {
				datePicker.setValueState(ValueState.None);
				datePicker.setValueStateText("");
			});
			if (event.getParameter("valid") === false) {
				changedPicker.setValueState(ValueState.Error);
				changedPicker.setValueStateText(bundle.getText("dateFilterInvalid"));
				return;
			}

			var dateFrom = fromPicker.getValue();
			var dateTo = toPicker.getValue();
			if ((dateFrom && !this._isValidExpenseDate(dateFrom)) ||
				(dateTo && !this._isValidExpenseDate(dateTo))) {
				var invalidPicker = dateFrom && !this._isValidExpenseDate(dateFrom) ?
					fromPicker : toPicker;
				invalidPicker.setValueState(ValueState.Error);
				invalidPicker.setValueStateText(bundle.getText("dateFilterInvalid"));
				return;
			}
			var viewState = this.getView().getModel("viewState");
			viewState.setProperty("/dateFrom", dateFrom);
			viewState.setProperty("/dateTo", dateTo);
			if (dateFrom && dateTo && dateFrom > dateTo) {
				toPicker.setValueState(ValueState.Error);
				toPicker.setValueStateText(bundle.getText("dateRangeInvalid"));
				return;
			}
		},

		onApplyFilters: function () {
			var viewState = this.getView().getModel("viewState");
			var dateFrom = viewState.getProperty("/dateFrom");
			var dateTo = viewState.getProperty("/dateTo");
			var fromPicker = this.byId("expenseDateFromFilter");
			var toPicker = this.byId("expenseDateToFilter");
			if (fromPicker.getValueState() === ValueState.Error ||
				toPicker.getValueState() === ValueState.Error) {
				return;
			}
			if (dateFrom && dateTo && dateFrom > dateTo) {
				toPicker.setValueState(ValueState.Error);
				toPicker.setValueStateText(
					this.getView().getModel("i18n").getResourceBundle()
						.getText("dateRangeInvalid")
				);
				return;
			}

			viewState.setProperty("/appliedDateFrom", dateFrom);
			viewState.setProperty("/appliedDateTo", dateTo);
			this._applyExpenseDateFilter();
			MessageToast.show(
				this.getView().getModel("i18n").getResourceBundle()
					.getText("filtersApplied")
			);
		},

		onResetFilters: function () {
			var viewState = this.getView().getModel("viewState");
			viewState.setProperty("/dateFrom", "");
			viewState.setProperty("/dateTo", "");
			viewState.setProperty("/appliedDateFrom", "");
			viewState.setProperty("/appliedDateTo", "");
			["expenseDateFromFilter", "expenseDateToFilter"].forEach(function (id) {
				var datePicker = this.byId(id);
				datePicker.setValueState(ValueState.None);
				datePicker.setValueStateText("");
			}, this);
			this._applyExpenseDateFilter();
		},

		_applyExpenseDateFilter: function () {
			var view = this.getView();
			var expensesModel = view.getModel("expenses");
			var viewState = view.getModel("viewState");
			var allItems = expensesModel.getProperty("/allItems") || [];
			var dateFrom = viewState.getProperty("/appliedDateFrom");
			var dateTo = viewState.getProperty("/appliedDateTo");
			var visibleItems = allItems.filter(function (expense) {
				return (!dateFrom || expense.expense_date >= dateFrom) &&
					(!dateTo || expense.expense_date <= dateTo);
			});
			expensesModel.setProperty("/items", visibleItems);
			this._updateDashboardMetrics(visibleItems, allItems);
			this._renderAnalytics(allItems);
		},

		_updateDashboardMetrics: function (visibleItems, allItems) {
			var viewState = this.getView().getModel("viewState");
			var total = this._sumExpenses(visibleItems);
			var currentMonth = this._getDateKey(new Date()).slice(0, 7);
			var monthExpenses = allItems.filter(function (expense) {
				return typeof expense.expense_date === "string" &&
					expense.expense_date.slice(0, 7) === currentMonth;
			});
			var monthTotal = this._sumExpenses(monthExpenses);
			var count = visibleItems.length;
			var bundle = this.getView().getModel("i18n").getResourceBundle();

			viewState.setProperty("/totalExpense", this._totalFormatter.format(total));
			viewState.setProperty("/monthExpense", this._totalFormatter.format(monthTotal));
			viewState.setProperty("/transactionCount", String(count));
			viewState.setProperty(
				"/averageExpense",
				this._totalFormatter.format(count ? total / count : 0)
			);
			viewState.setProperty(
				"/currentMonthLabel",
				new Date().toLocaleDateString(undefined, {
					month: "long",
					year: "numeric"
				})
			);
			viewState.setProperty(
				"/visibleTransactionLabel",
				bundle.getText("visibleTransactionCount", [count])
			);
		},

		_sumExpenses: function (expenses) {
			return expenses.reduce(function (sum, expense) {
				var amount = Number(expense.amount);
				return sum + (Number.isFinite(amount) ? amount : 0);
			}, 0);
		},

		_getDateKey: function (date) {
			var year = date.getFullYear();
			var month = ("0" + (date.getMonth() + 1)).slice(-2);
			var day = ("0" + date.getDate()).slice(-2);
			return year + "-" + month + "-" + day;
		},

		_getUserInitials: function (email) {
			if (!email) {
				return "";
			}
			var localPart = email.split("@")[0];
			var parts = localPart.split(/[._-]+/).filter(Boolean);
			return (parts.length > 1 ?
				parts[0].charAt(0) + parts[1].charAt(0) :
				localPart.slice(0, 2)).toUpperCase();
		},

		formatCategoryState: function (category) {
			var normalized = String(category || "").toLowerCase();
			if (normalized === "food") {
				return ValueState.Warning;
			}
			if (normalized === "travel") {
				return ValueState.Indication05;
			}
			if (normalized === "shopping") {
				return ValueState.Information;
			}
			if (normalized === "bills") {
				return ValueState.Success;
			}
			return ValueState.None;
		},

		_renderAnalytics: function (expenses) {
			var monthlyChart = this.byId("monthlyTrendChart");
			var categoryChart = this.byId("categoryBreakdownChart");
			var weeklyChart = this.byId("weeklyAnalyticsChart");
			if (monthlyChart) {
				monthlyChart.setContent(this._buildMonthlyTrendSvg(expenses));
			}
			if (categoryChart) {
				categoryChart.setContent(this._buildCategoryBreakdownSvg(expenses));
			}
			if (weeklyChart) {
				weeklyChart.setContent(this._buildWeeklyAnalyticsSvg(expenses));
			}
		},

		_buildMonthlyTrendSvg: function (expenses) {
			var now = new Date();
			var bundle = this.getView().getModel("i18n").getResourceBundle();
			var months = [];
			var totals = Object.create(null);
			for (var index = 5; index >= 0; index -= 1) {
				var monthDate = new Date(now.getFullYear(), now.getMonth() - index, 1);
				var key = this._getDateKey(monthDate).slice(0, 7);
				months.push({
					key: key,
					label: monthDate.toLocaleDateString(undefined, { month: "short" })
				});
				totals[key] = 0;
			}
			expenses.forEach(function (expense) {
				var key = typeof expense.expense_date === "string" ?
					expense.expense_date.slice(0, 7) : "";
				if (Object.prototype.hasOwnProperty.call(totals, key)) {
					var amount = Number(expense.amount);
					totals[key] += Number.isFinite(amount) ? amount : 0;
				}
			});

			var values = months.map(function (month) {
				return totals[month.key];
			});
			var maxValue = Math.max.apply(null, values.concat([1]));
			var left = 44;
			var right = 646;
			var top = 24;
			var baseline = 178;
			var points = values.map(function (value, pointIndex) {
				return {
					x: left + pointIndex * (right - left) / (values.length - 1),
					y: baseline - value / maxValue * (baseline - top)
				};
			});
			var linePath = points.map(function (point, pointIndex) {
				return (pointIndex ? "L" : "M") +
					point.x.toFixed(1) + " " + point.y.toFixed(1);
			}).join(" ");
			var areaPath = linePath + " L " + right + " " + baseline +
				" L " + left + " " + baseline + " Z";
			var labels = months.map(function (month, labelIndex) {
				return '<text class="chartAxisLabel" x="' +
					points[labelIndex].x.toFixed(1) + '" y="218" text-anchor="middle">' +
					this._escapeXml(month.label) + "</text>";
			}, this).join("");
			var circles = points.map(function (point) {
				return '<circle class="trendPoint" cx="' + point.x.toFixed(1) +
					'" cy="' + point.y.toFixed(1) + '" r="4.5" />';
			}).join("");

			return '<svg class="analyticsSvg trendSvg" viewBox="0 0 690 236" role="img" aria-label="' +
				this._escapeXml(bundle.getText("monthlyTrendTitle")) + '">' +
				'<defs><linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">' +
				'<stop offset="0%" stop-color="#7C5CFC" stop-opacity=".28"/>' +
				'<stop offset="100%" stop-color="#7C5CFC" stop-opacity="0"/>' +
				'</linearGradient></defs>' +
				'<line class="chartGridLine" x1="' + left + '" y1="' + top +
				'" x2="' + right + '" y2="' + top + '"/>' +
				'<line class="chartGridLine" x1="' + left + '" y1="' +
				((top + baseline) / 2) + '" x2="' + right + '" y2="' +
				((top + baseline) / 2) + '"/>' +
				'<line class="chartGridLine" x1="' + left + '" y1="' + baseline +
				'" x2="' + right + '" y2="' + baseline + '"/>' +
				'<path d="' + areaPath + '" fill="url(#trendFill)"/>' +
				'<path class="trendLine" d="' + linePath + '"/>' +
				circles + labels + "</svg>";
		},

		_buildCategoryBreakdownSvg: function (expenses) {
			var bundle = this.getView().getModel("i18n").getResourceBundle();
			var totals = Object.create(null);
			expenses.forEach(function (expense) {
				var category = String(expense.category || bundle.getText("otherCategoryLabel"));
				var amount = Number(expense.amount);
				totals[category] = (totals[category] || 0) +
					(Number.isFinite(amount) ? amount : 0);
			});
			var entries = Object.keys(totals).map(function (category) {
				return { label: category, value: totals[category] };
			}).sort(function (first, second) {
				return second.value - first.value;
			});
			if (entries.length > 5) {
				var otherValue = entries.slice(4).reduce(function (sum, entry) {
					return sum + entry.value;
				}, 0);
				entries = entries.slice(0, 4);
				entries.push({
					label: bundle.getText("otherCategoryLabel"),
					value: otherValue
				});
			}
			var total = entries.reduce(function (sum, entry) {
				return sum + entry.value;
			}, 0);
			if (!entries.length || total <= 0) {
				return this._emptyChartSvg(bundle.getText("chartNoCategoryData"));
			}

			var palette = ["#F59E0B", "#8B5CF6", "#3B82F6", "#10B981", "#EC4899"];
			var categoryColors = {
				food: "#F59E0B",
				travel: "#8B5CF6",
				shopping: "#3B82F6",
				bills: "#10B981"
			};
			var circumference = 2 * Math.PI * 58;
			var offset = 0;
			var segments = entries.map(function (entry, index) {
				var segmentLength = entry.value / total * circumference;
				var color = categoryColors[entry.label.toLowerCase()] ||
					palette[index % palette.length];
				var segment = '<circle cx="142" cy="116" r="58" fill="none" stroke="' +
					color + '" stroke-width="17" stroke-dasharray="' +
					segmentLength.toFixed(2) + " " +
					(circumference - segmentLength).toFixed(2) +
					'" stroke-dashoffset="' + (-offset).toFixed(2) + '"/>';
				offset += segmentLength;
				return segment;
			}).join("");
			var legend = entries.map(function (entry, index) {
				var color = categoryColors[entry.label.toLowerCase()] ||
					palette[index % palette.length];
				var y = 55 + index * 34;
				return '<circle cx="270" cy="' + (y - 5) +
					'" r="5" fill="' + color + '"/>' +
					'<text class="chartLegendLabel" x="284" y="' + y + '">' +
					this._escapeXml(entry.label) + '</text>' +
					'<text class="chartLegendValue" x="610" y="' + y +
					'" text-anchor="end">' +
					this._totalFormatter.format(entry.value) + "</text>";
			}, this).join("");

			return '<svg class="analyticsSvg categorySvg" viewBox="0 0 640 236" role="img" aria-label="' +
				this._escapeXml(bundle.getText("categoryBreakdownTitle")) + '">' +
				'<g transform="rotate(-90 142 116)">' + segments + "</g>" +
				'<text class="donutCenterLabel" x="142" y="111" text-anchor="middle">' +
				this._escapeXml(bundle.getText("chartTotalLabel")) + "</text>" +
				'<text class="donutCenterValue" x="142" y="135" text-anchor="middle">' +
				this._totalFormatter.format(total) + "</text>" +
				legend + "</svg>";
		},

		_buildWeeklyAnalyticsSvg: function (expenses) {
			var today = new Date();
			var bundle = this.getView().getModel("i18n").getResourceBundle();
			var days = [];
			var totals = Object.create(null);
			for (var index = 6; index >= 0; index -= 1) {
				var day = new Date(
					today.getFullYear(),
					today.getMonth(),
					today.getDate() - index
				);
				var key = this._getDateKey(day);
				days.push({
					key: key,
					label: day.toLocaleDateString(undefined, { weekday: "short" })
				});
				totals[key] = 0;
			}
			expenses.forEach(function (expense) {
				if (Object.prototype.hasOwnProperty.call(totals, expense.expense_date)) {
					var amount = Number(expense.amount);
					totals[expense.expense_date] += Number.isFinite(amount) ? amount : 0;
				}
			});
			var values = days.map(function (day) {
				return totals[day.key];
			});
			var maxValue = Math.max.apply(null, values.concat([1]));
			var bars = days.map(function (day, index) {
				var value = values[index];
				var height = value ? Math.max(value / maxValue * 132, 3) : 2;
				var x = 56 + index * 83;
				var y = 174 - height;
				return '<rect class="weeklyBar' + (index === days.length - 1 ?
					" weeklyBarCurrent" : "") + '" x="' + x + '" y="' + y.toFixed(1) +
					'" width="38" height="' + height.toFixed(1) +
					'" rx="8"><title>' + this._escapeXml(day.label) + ": " +
					this._totalFormatter.format(value) + "</title></rect>" +
					'<text class="chartAxisLabel" x="' + (x + 19) +
					'" y="207" text-anchor="middle">' +
					this._escapeXml(day.label) + "</text>";
			}, this).join("");

			return '<svg class="analyticsSvg weeklySvg" viewBox="0 0 650 226" role="img" aria-label="' +
				this._escapeXml(bundle.getText("weeklyAnalyticsTitle")) + '">' +
				'<line class="chartGridLine" x1="38" y1="42" x2="632" y2="42"/>' +
				'<line class="chartGridLine" x1="38" y1="108" x2="632" y2="108"/>' +
				'<line class="chartGridLine" x1="38" y1="176" x2="632" y2="176"/>' +
				bars + "</svg>";
		},

		_emptyChartSvg: function (message) {
			return '<svg class="analyticsSvg emptyChartSvg" viewBox="0 0 640 236" role="img" aria-label="' +
				this._escapeXml(message) + '">' +
				'<text class="emptyChartText" x="320" y="125" text-anchor="middle">' +
				this._escapeXml(message) + "</text></svg>";
		},

		_escapeXml: function (value) {
			return String(value).replace(/[&<>"']/g, function (character) {
				return {
					"&": "&amp;",
					"<": "&lt;",
					">": "&gt;",
					'"': "&quot;",
					"'": "&apos;"
				}[character];
			});
		},

		onOpenAddExpense: function () {
			this._openExpenseDialog(null);
		},

		onEditExpense: function (event) {
			var context = event.getSource().getBindingContext("expenses");
			if (!context) {
				MessageBox.error(
					this.getView().getModel("i18n").getResourceBundle()
						.getText("expenseRecordError")
				);
				return;
			}

			this._openExpenseDialog(context.getObject());
		},

		_openExpenseDialog: async function (expense) {
			try {
				if (!this._expenseDialog) {
					this._expenseDialog = await Fragment.load({
						id: this.getView().getId(),
						name: "expenseTrack.fragment.ExpenseDialog",
						controller: this
					});
					this._expenseDialog.addStyleClass("premiumDialog");
					this.getView().addDependent(this._expenseDialog);
				}

				var bundle = this.getView().getModel("i18n").getResourceBundle();
				var today = new Date();
				var dateValue = expense && expense.expense_date || today.getFullYear() + "-" +
					("0" + (today.getMonth() + 1)).slice(-2) + "-" +
					("0" + today.getDate()).slice(-2);
				var isEdit = Boolean(expense);
				this._editingExpenseId = isEdit ? expense.id : null;
				this._expenseDialog.setModel(new JSONModel({
					category: expense && expense.category || "",
					amount: expense && expense.amount !== undefined ?
						String(expense.amount) : "",
					description: expense && expense.description || "",
					expense_date: dateValue,
					dialogTitle: bundle.getText(isEdit ?
						"editExpenseDialogTitle" : "addExpenseDialogTitle"),
					submitLabel: bundle.getText(isEdit ? "updateButton" : "saveButton")
				}), "expenseForm");
				this._expenseDialog.open();
			} catch (error) {
				console.error("Failed to open the add expense dialog.", error);
				MessageBox.error(
					this.getView().getModel("i18n").getResourceBundle()
						.getText("expenseDialogError"),
					{ details: this._getErrorDetails(error) }
				);
			}
		},

		onSaveExpense: async function () {
			var dialog = this._expenseDialog;
			if (!dialog || this._isSavingExpense) {
				return;
			}

			var form = dialog.getModel("expenseForm").getData();
			var category = form.category.trim();
			var amount = Number(form.amount);
			var expenseDate = form.expense_date;
			var bundle = this.getView().getModel("i18n").getResourceBundle();
			var isEdit = this._editingExpenseId !== null &&
				this._editingExpenseId !== undefined;

			if (!category || !Number.isFinite(amount) || amount <= 0 ||
				!this._isValidExpenseDate(expenseDate)) {
				MessageBox.error(bundle.getText("expenseValidationError"));
				return;
			}

			this._isSavingExpense = true;
			dialog.setBusy(true);
			try {
				var response = await SupabaseService.request(
					isEdit ? "expenseTrack?id=eq." +
						encodeURIComponent(this._editingExpenseId) : "expenseTrack",
					{
						method: isEdit ? "PATCH" : "POST",
						headers: {
							Prefer: isEdit ? "return=representation" : "return=minimal"
						},
						body: {
							category: category,
							amount: amount,
							description: form.description.trim(),
							expense_date: expenseDate
						}
					}
				);
				if (isEdit && (!Array.isArray(response) || response.length === 0)) {
					throw new Error(bundle.getText("expenseUpdateNotFound"));
				}

				dialog.close();
				this._editingExpenseId = null;
				MessageToast.show(bundle.getText(isEdit ? "expenseUpdated" : "expenseCreated"));
				await this._loadExpenses();
			} catch (error) {
				console.error("Failed to save expense in Supabase.", error);
				MessageBox.error(
					bundle.getText("expenseSaveError"),
					{ details: this._getErrorDetails(error) }
				);
			} finally {
				this._isSavingExpense = false;
				dialog.setBusy(false);
			}
		},

		onDeleteExpense: function (event) {
			var context = event.getSource().getBindingContext("expenses");
			if (!context || context.getProperty("id") === undefined ||
				context.getProperty("id") === null) {
				MessageBox.error(
					this.getView().getModel("i18n").getResourceBundle()
						.getText("expenseRecordError")
				);
				return;
			}

			var expenseId = context.getProperty("id");
			var bundle = this.getView().getModel("i18n").getResourceBundle();
			MessageBox.confirm(bundle.getText("deleteExpenseConfirm"), {
				actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
				emphasizedAction: MessageBox.Action.DELETE,
				onClose: function (action) {
					if (action === MessageBox.Action.DELETE) {
						this._deleteExpense(expenseId);
					}
				}.bind(this)
			});
		},

		_deleteExpense: async function (expenseId) {
			if (this._isDeletingExpense) {
				return;
			}

			var viewState = this.getView().getModel("viewState");
			var bundle = this.getView().getModel("i18n").getResourceBundle();
			this._isDeletingExpense = true;
			viewState.setProperty("/busy", true);
			try {
				var deletedRows = await SupabaseService.request(
					"expenseTrack?id=eq." + encodeURIComponent(expenseId),
					{
						method: "DELETE",
						headers: {
							Prefer: "return=representation"
						}
					}
				);
				if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
					throw new Error(bundle.getText("expenseDeleteNotFound"));
				}

				MessageToast.show(bundle.getText("expenseDeleted"));
				await this._loadExpenses();
			} catch (error) {
				console.error("Failed to delete expense in Supabase.", error);
				MessageBox.error(
					bundle.getText("expenseDeleteError"),
					{ details: this._getErrorDetails(error) }
				);
			} finally {
				this._isDeletingExpense = false;
				viewState.setProperty("/busy", false);
			}
		},

		onCancelAddExpense: function () {
			if (this._expenseDialog) {
				this._expenseDialog.close();
			}
			this._editingExpenseId = null;
		},

		_isValidExpenseDate: function (value) {
			if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
				return false;
			}

			var date = new Date(value + "T00:00:00Z");
			return !Number.isNaN(date.getTime()) &&
				date.toISOString().slice(0, 10) === value;
		},

		_getErrorDetails: function (error) {
			if (typeof error.details === "string") {
				return error.details;
			}
			return error.details ? JSON.stringify(error.details) : error.message;
		},

		onExit: function () {
			this._isExiting = true;
			if (this._expenseDialog) {
				this._expenseDialog.destroy();
				this._expenseDialog = null;
			}
			if (this._authDialog) {
				this._authDialog.destroy();
				this._authDialog = null;
			}
			this.getView().setModel(null, "viewState");
		}
	});
});
