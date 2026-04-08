import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter, Navigate, Route, Routes} from "react-router";
import {useSession} from "./lib/auth-client";
import LoginPage from "./routes/auth/login";
import SignupPage from "./routes/auth/signup";
import "./index.css";
import {AppLayout} from "@/components/app-layout";
import {Toaster} from "@/components/ui/sonner";
import Dashboard from "@/routes/app/dashboard";
import StacksPage from "@/routes/app/stacks/index";
import CreateStackPage from "@/routes/app/stacks/create";
import StackDetailPage from "@/routes/app/stacks/[id]";
import SettingsPage from "@/routes/app/settings";
import BackupDetailPage from "@/routes/app/stacks/backups/[backupId]";
import SetupPage from "./routes/setup";

function ProtectedRoute({children}: Readonly<{children: React.ReactNode}>) {
    const {data: session, isPending} = useSession();

    if (isPending) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <p className="text-gray-500">Loading...</p>
            </div>
        );
    }

    if (!session) {
        return <Navigate to="/login" replace />;
    }

    return <>{children}</>;
}

function App() {
    return (
        <BrowserRouter>
            <Toaster />
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/setup" element={<SetupPage />} />
                <Route
                    element={
                        <ProtectedRoute>
                            <AppLayout />
                        </ProtectedRoute>
                    }
                >
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/stacks" element={<StacksPage />} />
                    <Route
                        path="/stacks/create"
                        element={<CreateStackPage />}
                    />
                    <Route
                        path="/stacks/:id/backups/:backupId"
                        element={<BackupDetailPage />}
                    />
                    <Route
                        path="/stacks/:id/:tab?"
                        element={<StackDetailPage />}
                    />
                    <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
                    <Route path="/settings/:tab" element={<SettingsPage />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
