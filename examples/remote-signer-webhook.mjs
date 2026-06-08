#!/usr/bin/env node
/**
 * Standalone identity webhook for go-livepeer -remoteSignerWebhookUrl.
 *
 * Env (see auth0-livepeer .env.livepeer):
 *   JWT_ISSUER, JWT_AUDIENCE, WEBHOOK_SECRET
 *   CLAIM_CLIENT_ID=azp (Auth0)
 *   USAGE_SUBJECT_TYPE=auth0_user_id
 *
 *   node examples/remote-signer-webhook.mjs
 */
import { startRemoteSignerWebhookServer } from "../dist/signer/webhook.js";

startRemoteSignerWebhookServer();
