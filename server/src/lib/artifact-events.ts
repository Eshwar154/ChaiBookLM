import { inngest } from "../inngest/client.js";

export async function enqueueArtifactGeneration(input: {
    artifactId: string;
    workspaceId: string;
}) {
    await inngest.send({
        name: "artifact/generate",
        data: input,
    });
}
