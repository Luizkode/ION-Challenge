import "server-only";
import { check, type session } from "./session";
import { hasFunction } from "./access";
import { dayBounds } from "./crm-agenda";
type Context = Awaited<ReturnType<typeof session>>;
export const meetingSelect =
  "*,crm_meeting_results(id,outcome),opportunities!inner(crm_lead_id,company,contact,phone,campaign_id,sdr_id)";
export const followupSelect =
  "*,crm_leads!inner(id,company,contact,phone,sdr_id,closer_id,stage,archived)";
export function scopedMeetings({ db, profile }: Context) {
  let q = db
    .from("meetings")
    .select(meetingSelect, { count: "exact" })
    .not("opportunities.crm_lead_id", "is", null);
  if (profile.category !== "admin") {
    if (hasFunction(profile, "closer")) q = q.eq("closer_id", profile.id);
    else if (hasFunction(profile, "sdr"))
      q = q.eq("opportunities.sdr_id", profile.id);
  }
  return q;
}
export function scopedFollowups({ db, profile }: Context) {
  let q = db.from("crm_followups").select(followupSelect, { count: "exact" });
  if (
    profile.category !== "admin" &&
    (hasFunction(profile, "sdr") || hasFunction(profile, "closer"))
  )
    q = q.eq("assigned_to", profile.id);
  return q;
}
export async function workspaceSummary(ctx: Context) {
  const { start, end } = dayBounds();
  const [today, upcoming, awaiting, overdue, followups, negotiations] =
    await Promise.all([
      scopedMeetings(ctx)
        .eq("status", "scheduled")
        .gte("scheduled_at", start)
        .lt("scheduled_at", end)
        .order("scheduled_at")
        .limit(5),
      scopedMeetings(ctx)
        .eq("status", "scheduled")
        .gte("scheduled_at", end)
        .order("scheduled_at")
        .limit(5),
      scopedMeetings(ctx)
        .in("status", ["scheduled", "pending", "held", "qualified", "no_show"])
        .is("crm_meeting_results", null)
        .lt("scheduled_at", new Date().toISOString())
        .order("scheduled_at")
        .limit(100),
      scopedFollowups(ctx)
        .eq("status", "pending")
        .lt("due_at", new Date().toISOString())
        .order("due_at")
        .limit(5),
      scopedFollowups(ctx)
        .eq("status", "pending")
        .gte("due_at", start)
        .lt("due_at", end)
        .order("due_at")
        .limit(5),
      ctx.db
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("archived", false)
        .in("stage", ["negotiation", "proposed"]),
    ]);
  for (const r of [today, upcoming, awaiting, overdue, followups, negotiations])
    check(r.error);
  const ids = (awaiting.data ?? []).map((m) => m.id);
  const recorded = ids.length
    ? await ctx.db
        .from("crm_meeting_results")
        .select("meeting_id")
        .in("meeting_id", ids)
    : { data: [], error: null };
  check(recorded.error);
  const done = new Set((recorded.data ?? []).map((r) => r.meeting_id));
  return {
    today,
    upcoming,
    awaiting: (awaiting.data ?? []).filter((m) => !done.has(m.id)),
    overdue,
    followups,
    negotiations: negotiations.count ?? 0,
  };
}
