import { requireAuth, SignOutButton } from "@/features/auth";
import { memoryRoutes } from "@/features/memory";
import { WorkspaceList } from "@/features/workspaces";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrainIcon } from "lucide-react";

export default async function DashboardPage() {
    await requireAuth();

    return (
        <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="font-heading text-2xl font-semibold">
                        Dashboard
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Manage your Chaibook workspaces.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        nativeButton={false}
                        variant="outline"
                        size="sm"
                        render={<Link href={memoryRoutes.settings} />}
                    >
                        <BrainIcon />
                        Memory
                    </Button>
                    <SignOutButton />
                </div>
            </div>

            <WorkspaceList />
        </div>
    );
}
