"use client";

import Link from "next/link";
import { ArrowLeftIcon, BookOpenIcon, MessageSquareIcon } from "lucide-react";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { Button } from "@/components/ui/button";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarRail,
    SidebarTrigger,
} from "@/components/ui/sidebar";
import { workspaceRoutes } from "../lib/routes";
import type { Workspace } from "../lib/types";

type WorkspaceShellProps = {
    workspace: Workspace;
    children: React.ReactNode;
};

export function WorkspaceShell({ workspace, children }: WorkspaceShellProps) {
    return (
        <SidebarProvider>
            <Sidebar>
                <SidebarHeader className="border-b border-sidebar-border">
                    <div className="flex items-center gap-2 px-2 py-1">
                        <span className="text-xl">{workspace.icon ?? "📚"}</span>
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">
                                {workspace.title}
                            </p>
                            {workspace.description ? (
                                <p className="truncate text-xs text-muted-foreground">
                                    {workspace.description}
                                </p>
                            ) : null}
                        </div>
                    </div>
                </SidebarHeader>

                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupLabel>Workspace</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                <SidebarMenuItem>
                                    <SidebarMenuButton isActive>
                                        <MessageSquareIcon />
                                        <span>Chat</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                                <SidebarMenuItem>
                                    <SidebarMenuButton disabled>
                                        <BookOpenIcon />
                                        <span>Sources</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>

                <SidebarFooter className="border-t border-sidebar-border">
                    <Button
                        nativeButton={false}
                        variant="ghost"
                        className="w-full justify-start"
                        render={<Link href={workspaceRoutes.list} />}
                    >
                        <ArrowLeftIcon />
                        All workspaces
                    </Button>
                </SidebarFooter>

                <SidebarRail />
            </Sidebar>

            <SidebarInset>
                <header className="flex h-14 items-center gap-3 border-b px-4">
                    <SidebarTrigger />
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate font-heading text-base font-semibold">
                            {workspace.title}
                        </h1>
                    </div>
                    <SignOutButton />
                </header>

                <main className="flex flex-1 flex-col">{children}</main>
            </SidebarInset>
        </SidebarProvider>
    );
}
