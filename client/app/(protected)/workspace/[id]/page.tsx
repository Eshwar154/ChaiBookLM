import { notFound } from "next/navigation";
import { requireAuth } from "@/features/auth";
import { getWorkspaceOrNull, WorkspaceShell } from "@/features/workspaces";

type WorkspacePageProps = {
    params: Promise<{ id: string }>;
};

export default async function WorkspacePage({ params }: WorkspacePageProps) {
    await requireAuth();
    const { id } = await params;
    const workspace = await getWorkspaceOrNull(id);

    if (!workspace) {
        notFound();
    }

    return (
        <WorkspaceShell workspace={workspace}>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="font-heading text-lg font-medium">
                    Workspace ready
                </p>
                <p className="max-w-md text-sm text-muted-foreground">
                    Chat and sources will live here. Add knowledge sources in
                    the next phase to start chatting with your books.
                </p>
            </div>
        </WorkspaceShell>
    );
}
