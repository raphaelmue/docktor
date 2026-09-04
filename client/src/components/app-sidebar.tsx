import {Link, useLocation} from "react-router";
import {Layers, LayoutDashboard, Settings} from "lucide-react";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";
import {NavUser} from "@/components/nav-user";
import {Separator} from "@/components/ui/separator";

const navItems = [
    {to: "/", label: "Dashboard", icon: LayoutDashboard},
    {to: "/stacks", label: "Stacks", icon: Layers},
    {to: "/settings", label: "Settings", icon: Settings},
];

export function AppSidebar() {
    const location = useLocation();

    return (
        <Sidebar>
            <SidebarHeader>
                <div className="px-2 py-2">
                    <h1 className="text-xl font-bold">Docktor</h1>
                </div>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Platform</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {navItems.map((item) => {
                                const active =
                                    item.to === "/"
                                        ? location.pathname === "/"
                                        : location.pathname.startsWith(item.to);
                                return (
                                    <SidebarMenuItem key={item.to}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={active}
                                        >
                                            <Link to={item.to}>
                                                <item.icon/>
                                                <span>{item.label}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                );
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <Separator />
            <SidebarFooter>
                <NavUser/>
            </SidebarFooter>
        </Sidebar>
    );
}
