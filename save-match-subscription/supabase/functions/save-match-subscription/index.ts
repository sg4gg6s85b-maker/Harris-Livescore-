import { createClient } from "npm:@supabase/supabase-js@2";

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

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed." }, 405);
  }

  try {
    const { match_id, subscription } = await req.json();

    if (
      typeof match_id !== "string" ||
      typeof subscription?.endpoint !== "string" ||
      typeof subscription?.keys?.p256dh !== "string" ||
      typeof subscription?.keys?.auth !== "string"
    ) {
      return respond({ error: "Invalid subscription details." }, 400);
    }

    if (!subscription.endpoint.startsWith("https://")) {
      return respond({ error: "Invalid notification endpoint." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: match, error: matchError } = await adminClient
      .from("matches")
      .select("id, status, kickoff")
      .eq("id", match_id)
      .maybeSingle();

    if (matchError) throw matchError;

    if (!match) {
      return respond({ error: "Match not found." }, 404);
    }

    if (
      match.status !== "upcoming" ||
      !match.kickoff ||
      new Date(match.kickoff).getTime() <= Date.now()
    ) {
      return respond({ error: "Subscriptions are closed for this match." }, 400);
    }

    const { error: saveError } = await adminClient
      .from("match_push_subscriptions")
      .upsert(
        {
          match_id,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
        { onConflict: "match_id,endpoint" }
      );

    if (saveError) throw saveError;

    return respond({
      success: true,
      message: "Match alerts successfully enabled.",
    });
  } catch (error) {
    console.error("Subscription error:", error);
    return respond({ error: "Could not save notification subscription." }, 500);
  }
});
