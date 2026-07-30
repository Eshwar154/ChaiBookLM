import type { ChatCitation } from "./types";

export function getCitationByIndex(
    citations: ChatCitation[],
    index: number,
) {
    return citations[index - 1] ?? null;
}

export function uniqueCitationsBySource(citations: ChatCitation[]) {
    return citations.filter(
        (citation, index, array) =>
            array.findIndex((item) => item.sourceId === citation.sourceId) ===
            index,
    );
}
