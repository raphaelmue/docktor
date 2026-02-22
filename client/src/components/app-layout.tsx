import {Outlet} from "react-router";
import {SidebarInset, SidebarProvider} from "@/components/ui/sidebar";
import {AppSidebar} from "@/components/app-sidebar";

export function AppLayout() {
    return (
        <div className={"font-mono"}>
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
                <Outlet />
            </SidebarInset>
        </SidebarProvider>
        </div>
    );
}
