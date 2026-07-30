"use client";

import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card";
import type { ChatCitation } from "../lib/types";
import { CitationPreview } from "./citation-preview";

type CitationMarkerProps = {
    index: number;
    citation: ChatCitation;
    workspaceId: string;
};

export function CitationMarker({
    index,
    citation,
    workspaceId,
}: CitationMarkerProps) {
    return (
        <HoverCard>
            <HoverCardTrigger
                delay={120}
                closeDelay={80}
                render={
                    <button
                        type="button"
                        className="mx-0.5 inline-flex size-5 -translate-y-px items-center justify-center rounded-full bg-primary/15 align-middle text-[10px] font-semibold text-primary transition-colors hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                        aria-label={`Source ${index}: ${citation.sourceTitle}`}
                    >
                        {index}
                    </button>
                }
            />
            <HoverCardContent side="top" align="start" className="w-80">
                <CitationPreview
                    citation={citation}
                    workspaceId={workspaceId}
                    markerIndex={index}
                />
            </HoverCardContent>
        </HoverCard>
    );
}
