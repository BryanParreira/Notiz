import { useLingui } from "@lingui/react/macro";
import {
  CalendarIcon,
  HistoryIcon,
  LinkIcon,
  MapPinIcon,
  UsersIcon,
} from "lucide-react";
import { useMemo } from "react";

import { BriefEmails } from "./brief-emails";
import { getCompiledInsightFacts } from "./insights";

import { useSessionBrief } from "~/session/insights/brief";
import {
  useLastMeetings,
  usePastSessionNotes,
} from "~/session/insights/past-notes";
import { useTabs } from "~/store/zustand/tabs";

export function Brief({ sessionId }: { sessionId: string }) {
  const { t } = useLingui();
  const brief = useSessionBrief(sessionId);
  const pastNotes = usePastSessionNotes(sessionId);
  const insightFacts = useMemo(
    () => getCompiledInsightFacts(pastNotes.notes),
    [pastNotes.notes],
  );
  const lastMeetings = useLastMeetings(sessionId);
  const openNew = useTabs((state) => state.openNew);

  if (!brief) {
    return null;
  }

  return (
    <div
      data-session-brief
      className="scroll-fade-y h-full overflow-y-auto py-4 pr-3 pl-3"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{brief.eventTitle}</h2>

          {brief.startLabel ? (
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <CalendarIcon size={12} className="shrink-0" />
              <span>{brief.startLabel}</span>
            </div>
          ) : null}

          {brief.participantNames.length > 0 ? (
            <div className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <UsersIcon size={12} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">
                {brief.participantNames.join(", ")}
              </span>
            </div>
          ) : null}

          {brief.location ? (
            <div className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <MapPinIcon size={12} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{brief.location}</span>
            </div>
          ) : null}

          {brief.meetingLink ? (
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <LinkIcon size={12} className="shrink-0" />
              <a
                href={brief.meetingLink}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate underline"
              >
                {brief.meetingLink}
              </a>
            </div>
          ) : null}
        </div>

        {lastMeetings.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {t`Last met`}
            </h3>
            <ul className="flex min-w-0 flex-col gap-1.5">
              {lastMeetings.map((meeting) => (
                <li key={meeting.humanId} className="min-w-0">
                  <button
                    type="button"
                    onClick={() =>
                      openNew({ type: "sessions", id: meeting.sessionId })
                    }
                    className="text-muted-foreground hover:text-foreground flex w-full min-w-0 items-start gap-1.5 text-left text-xs leading-5"
                  >
                    <HistoryIcon size={12} className="mt-1 shrink-0" />
                    <span className="min-w-0 break-words">
                      <span className="text-foreground font-medium">
                        {meeting.name}
                      </span>
                      {" · "}
                      {[meeting.dateLabel, meeting.title]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <BriefEmails sessionId={sessionId} />

        {insightFacts.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {t`From past meetings`}
            </h3>
            <ul className="text-muted-foreground min-w-0 list-disc space-y-2 pr-1 pl-5 text-xs leading-5">
              {insightFacts.map((fact) => (
                <li key={fact.key} className="min-w-0 break-words">
                  {fact.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
