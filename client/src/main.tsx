import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter, Navigate, Route, Routes} from "react-router";
import {signOut, useSession} from "./lib/auth-client";
import LoginPage from "./routes/auth/login";
import SignupPage from "./routes/auth/signup";
import "./index.css";
import Dashboard from "@/routes/app/dashboard";

function ProtectedRoute({children}: { children: React.ReactNode }) {
    const {data: session, isPending} = useSession();

    if (isPending) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <p className="text-gray-500">Loading...</p>
            </div>
        );
    }

    if (!session) {
        return <Navigate to="/login" replace/>;
    }

    return <>{children}</>;
}

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<LoginPage/>}/>
                <Route path="/signup" element={<SignupPage/>}/>
                <Route
                    path="/"
                    element={
                        <ProtectedRoute>
                            <Dashboard/>
                        </ProtectedRoute>
                    }
                />
            </Routes>
        </BrowserRouter>
    );
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App/>
    </StrictMode>,
);
