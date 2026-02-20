import * as React from "react"

import {cn} from "@/lib/utils"
import {SidebarTrigger} from "@/components/ui/sidebar"
import {Separator} from "@/components/ui/separator"

function Page({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="page"
            className={cn("flex flex-col flex-1", className)}
            {...props}
        />
    )
}

function PageHeader({
                        breadcrumbs,
                        className,
                        children,
                        ...props
                    }: React.ComponentProps<"header"> & { breadcrumbs?: React.ReactNode }) {
    return (
        <header
            data-slot="page-header"
            className={cn("flex flex-col gap-4", className)}
            {...props}>
            <div className="flex items-center gap-3 px-6 pt-4">
                <SidebarTrigger/>
                <Separator orientation="vertical" className={"max-h-4"}/>
                <div className={"px-1"}>
                    {breadcrumbs}
                </div>
            </div>
            <Separator/>
            <div className="flex items-center justify-between px-6">{children}</div>
        </header>
    )
}

function PageTitle({className, children, ...props}: React.ComponentProps<"h1">) {
    return (
        <h1
            data-slot="page-title"
            className={cn("text-2xl font-bold", className)}
            {...props}
        >
            {children}
        </h1>
    )
}

function PageDescription({className, ...props}: React.ComponentProps<"p">) {
    return (
        <p
            data-slot="page-description"
            className={cn("text-muted-foreground", className)}
            {...props}
        />
    )
}

function PageActions({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="page-actions"
            className={cn("flex items-center gap-2", className)}
            {...props}
        />
    )
}

function PageContent({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="page-content"
            className={cn("p-6 space-y-6", className)}
            {...props}
        />
    )
}

function PageFooter({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="page-footer"
            className={cn("flex items-center p-6 pt-0", className)}
            {...props}
        />
    )
}

export {
    Page,
    PageHeader,
    PageTitle,
    PageDescription,
    PageActions,
    PageContent,
    PageFooter,
}
