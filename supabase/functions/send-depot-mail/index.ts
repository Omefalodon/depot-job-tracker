// Sends the "container done" e-mail to the depot through the company's Google Workspace (smtp.gmail.com:465).
// Secrets (set by George in the Supabase dashboard, never in code): SMTP_USER (the sending hct.gr mailbox), SMTP_PASS (its Google app password).
// Only active app users may call it, and only @hct.gr addresses can be written to.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import nodemailer from "npm:nodemailer@6.9.16";

const ORIGINS = ["https://omefalodon.github.io", "http://localhost:8765"];
const ALLOWED_TO = /^[A-Za-z0-9._%+-]+@hct\.gr$/i;

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method" });

  // Who is calling? Use their own token, so the profile read goes through RLS.
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json(req, 401, { error: "not signed in" });
  const { data: prof } = await sb.from("profiles").select("full_name,email,role,active").eq("id", u.user.id).maybeSingle();
  if (!prof || !prof.active || !["admin", "office", "depot"].includes(prof.role)) return json(req, 403, { error: "not allowed" });

  let body: { to?: string; subject?: string; text?: string };
  try { body = await req.json(); } catch { return json(req, 400, { error: "bad request" }); }
  const to = String(body.to ?? "").trim(), subject = String(body.subject ?? "").trim(), text = String(body.text ?? "");
  if (!ALLOWED_TO.test(to)) return json(req, 400, { error: "Only @hct.gr addresses can be sent to" });
  if (!subject || subject.length > 200 || !text.trim() || text.length > 4000) return json(req, 400, { error: "Subject or message missing or too long" });

  const user = Deno.env.get("SMTP_USER"), pass = Deno.env.get("SMTP_PASS");
  if (!user || !pass) return json(req, 503, { error: "not_configured" });

  try {
    const tx = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
    await tx.sendMail({
      from: { name: "Depot Job Tracker" + (prof.full_name ? " (" + prof.full_name + ")" : ""), address: user },
      to, subject, text,
      replyTo: prof.email || u.user.email || undefined,
    });
    return json(req, 200, { ok: true });
  } catch (e) {
    console.error("send failed", e instanceof Error ? e.message : e);
    return json(req, 502, { error: "The mail server refused the message" });
  }
});
