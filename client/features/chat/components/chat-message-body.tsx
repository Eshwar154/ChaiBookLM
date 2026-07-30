"use client";

import { useMemo } from "react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { getCitationByIndex } from "../lib/citations";
import type { ChatCitation } from "../lib/types";
import { CitationMarker } from "./citation-marker";

type ChatMessageBodyProps = {
    text: string;
    citations?: ChatCitation[];
    workspaceId: string;
    isAnimating?: boolean;
};

function injectCitationTags(text: string) {
    return text.replace(/\[(\d+)\]/g, '<cite index="$1">$1</cite>');
}

export function ChatMessageBody({
    text,
    citations = [],
    workspaceId,
    isAnimating = false,
}: ChatMessageBodyProps) {
    const markdown = useMemo(() => injectCitationTags(text), [text]);
    const plugins = useMemo(() => ({ code }), []);

    const components = useMemo(
        () => ({
            cite: ({
                index,
                children,
            }: {
                index?: string;
                children?: React.ReactNode;
            }) => {
                const citationIndex = Number(index ?? children);
                const citation = getCitationByIndex(citations, citationIndex);

                if (!citation) {
                    return (
                        <span className="font-medium text-primary">
                            [{citationIndex}]
                        </span>
                    );
                }

                return (
                    <CitationMarker
                        index={citationIndex}
                        citation={citation}
                        workspaceId={workspaceId}
                    />
                );
            },
        }),
        [citations, workspaceId],
    );

    return (
        <Streamdown
            mode={isAnimating ? "streaming" : "static"}
            isAnimating={isAnimating}
            plugins={plugins}
            allowedTags={{ cite: ["index"] }}
            literalTagContent={["cite"]}
            components={components}
            className="min-w-0 text-sm leading-relaxed"
        >
            {markdown}
        </Streamdown>
    );
}
