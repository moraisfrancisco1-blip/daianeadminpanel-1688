import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles.css";
import App from "./app.tsx";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// Keep admin data (bookings, invoices, payments) live without a manual
			// refresh — polls every 30s while the tab is focused, and every visible
			// query also refetches on window focus (react-query default).
			refetchInterval: 30_000,
			refetchIntervalInBackground: false,
		},
	},
});

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<Router>
				<App />
			</Router>
		</QueryClientProvider>
	</StrictMode>,
);
