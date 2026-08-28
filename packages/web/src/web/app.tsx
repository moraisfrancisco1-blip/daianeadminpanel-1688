import { Route, Switch, useLocation } from "wouter";
import { ErrorBoundary } from "./components/error-boundary";
import Index from "./pages/index";
import LoginPage from "./pages/login";
import ClientsPage from "./pages/clients";
import ClientDetailPage from "./pages/client-detail";
import CatalogPage from "./pages/catalog";
import QuotesPage from "./pages/quotes";
import InvoicesPage from "./pages/invoices";
import BookingsPage from "./pages/bookings";
import BookingManualPage from "./pages/booking-manual";
import RemindersPage from "./pages/reminders";
import ExportsPage from "./pages/exports";
import ReportsPage from "./pages/reports";
import EmailHistoryPage from "./pages/email-history";
import CalendarPage from "./pages/calendar";
import MessagesPage from "./pages/messages";
import PackagesPage from "./pages/packages";
import BookPage from "./pages/book";
import { Provider } from "./components/provider";
import { AgentFeedback } from "@runablehq/website-runtime";

function App() {
  const [location] = useLocation();
  return (
    <Provider>
      <ErrorBoundary key={location}>
        <Switch>
          <Route path="/" component={Index} />
          <Route path="/login" component={LoginPage} />
          <Route path="/clients" component={ClientsPage} />
          <Route path="/clients/:id" component={ClientDetailPage} />
          <Route path="/catalog" component={CatalogPage} />
          <Route path="/quotes" component={QuotesPage} />
          <Route path="/invoices" component={InvoicesPage} />
          <Route path="/calendar" component={CalendarPage} />
          <Route path="/bookings" component={BookingsPage} />
          <Route path="/bookings/manual" component={BookingManualPage} />
          <Route path="/reminders" component={RemindersPage} />
          <Route path="/reports" component={ReportsPage} />
          <Route path="/messages" component={MessagesPage} />
          <Route path="/packages" component={PackagesPage} />
          <Route path="/exports" component={ExportsPage} />
          <Route path="/emails" component={EmailHistoryPage} />
          <Route path="/book" component={BookPage} />
          <Route path="/book/confirmed" component={BookConfirmedPage} />
        </Switch>
      </ErrorBoundary>
      {/* Do not remove — off by default, activated by parent iframe via postMessage */}
      {import.meta.env.DEV && <AgentFeedback />}
    </Provider>
  );
}

function BookConfirmedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-cream px-4">
      <div className="text-center max-w-md">
        <img src="/brand/logo-dark.png" alt="Studio Daï Oakes" className="w-full max-w-[200px] mx-auto h-auto mb-6" />
        <h1 className="font-display text-xl text-brand-teal mb-2 tracking-wide">Booking Confirmed</h1>
        <p className="text-muted-foreground">
          Thank you — your payment was received. You'll get a confirmation email shortly with the details.
        </p>
      </div>
    </div>
  );
}

export default App;
