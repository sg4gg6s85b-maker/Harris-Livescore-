import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return respond({ error: "Authorisation required." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return respond({ error: "Invalid login." }, 401);

    const { data: isAdmin, error: adminError } = await userClient.rpc("is_harris_admin");
    if (adminError || !isAdmin) return respond({ error: "Administrator access required." }, 403);

    const { match_id, event_key, event_type, message } = await req.json();
    if (typeof match_id !== "string" || typeof event_key !== "string" ||
        typeof event_type !== "string" || typeof message !== "string" ||
        !event_key.trim() || !message.trim()) {
      return respond({ error: "Missing or invalid notification details." }, 400);
    }
    if (!["kickoff", "goal", "halftime", "fulltime"].includes(event_type)) {
      return respond({ error: "Invalid event type." }, 400);
    }

    const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const subject = Deno.env.get("VAPID_SUBJECT");
    if (!publicKey || !privateKey || !subject) {
      return respond({ error: "Push notification settings are incomplete." }, 500);
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { error: eventError } = await adminClient.from("match_notification_events").insert({
      match_id, event_key, event_type, message: message.trim(),
    });
    if (eventError) {
      if (eventError.code === "23505") return respond({ error: "This notification was already sent." }, 409);
      throw eventError;
    }

    const { data: subscriptions, error: subscriptionError } = await adminClient
      .from("match_push_subscriptions").select("id, endpoint, p256dh, auth").eq("match_id", match_id);
    if (subscriptionError) throw subscriptionError;

    let sent = 0;
    let failed = 0;
    for (const sub of subscriptions ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: "Harris Livescore 🔔", body: message.trim(), url: "/", tag: event_key }),
        );
        sent++;
      } catch (error) {
        failed++;
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await adminClient.from("match_push_subscriptions").delete().eq("id", sub.id);
        }
        console.error("Push delivery failed:", status ?? error);
      }
    }
    return respond({ success: true, notifications_sent: sent, notifications_failed: failed });
  } catch (error) {
    console.error("send-match-notification error:", error);
    return respond({ error: "Notification sending failed." }, 500);
  }
});
