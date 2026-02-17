import {Link, Outlet, useLocation} from "react-router";
import {LayoutDashboard, Layers, LogOut} from "lucide-react";
import {signOut, useSession} from "@/lib/auth-client";
import {Button} from "@/components/ui/button";
import {Separator} from "@/components/ui/separator";
import {cn} from "@/lib/utils";

const navItems = [
    {to: "/", label: "Dashboard", icon: LayoutDashboard},
    {to: "/stacks", label: "Stacks", icon: Layers},
];

export function AppLayout() {
    const {data: session} = useSession();
    const location = useLocation();

    return (
        <div className="flex min-h-screen">
            <aside className="w-64 border-r bg-muted/40 flex flex-col">
                <div className="p-4">
                    <h1 className="text-xl font-bold">Docktor</h1>
                </div>
                <Separator />
                <nav className="flex-1 p-2 space-y-1">
                    {navItems.map((item) => {
                        const active =
                            item.to === "/"
                                ? location.pathname === "/"
                                : location.pathname.startsWith(item.to);
                        return (
                            <Link
                                key={item.to}
                                to={item.to}
                                className={cn(
                                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                    active
                                        ? "bg-accent text-accent-foreground"
                                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                                )}
                            >
                                <item.icon className="h-4 w-4" />
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>
                <Separator />
                <div className="p-4 space-y-2">
                    <p className="text-sm text-muted-foreground truncate">
                        {session?.user?.name}
                    </p>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start gap-2"
                        onClick={() => signOut()}
                    >
                        <LogOut className="h-4 w-4" />
                        Sign out
                    </Button>
                </div>
            </aside>
            <main className="flex-1 overflow-auto">
                <Outlet />
            </main>
        </div>
    );
}
