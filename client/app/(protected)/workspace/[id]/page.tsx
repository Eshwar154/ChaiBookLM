import { notFound } from "next/navigation";
import { requireAuth } from "@/features/auth";
import { WorkspaceChat } from "@/features/chat";
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
            <WorkspaceChat workspaceId={workspace.id} />
        </WorkspaceShell>
    );
}
