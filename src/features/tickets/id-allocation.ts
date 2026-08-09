/*
Ticket-Bot is licensed under the GNU Affero General Public License,
version 3 only ("AGPL-3.0-only"). See LICENSE.md for the full license text.

Additional Term under GNU AGPL v3, Section 7(b):

You are required to preserve and display, in a location clearly visible
to end users interacting with the bot (such as bot embeds, the bot's
"Bio" Discord profile, status, or equivalent), a notice that the
software is powered by Ticket-Bot, including a link to the original
project repository or to its website.

This notice must not be removed, obscured, or replaced.
*/

import { sql } from "drizzle-orm";
import type { BotApp } from "@/core/types";
import { appMetaTable, ticketsTable } from "@/db/schema";

const TICKET_ID_SEQUENCE_KEY = "ticketIdSequence";

export async function reserveTicketId(app: Pick<BotApp, "db">) {
	const updatedAt = Date.now();
	const rows = await app.db
		.insert(appMetaTable)
		.values({
			key: TICKET_ID_SEQUENCE_KEY,
			value: sql<string>`CAST(COALESCE((SELECT MAX(${ticketsTable.id}) FROM ${ticketsTable}), 0) + 1 AS TEXT)`,
			updatedAt
		})
		.onConflictDoUpdate({
			target: appMetaTable.key,
			set: {
				// One upsert both catches up with existing rows and serializes concurrent reservations.
				value: sql<string>`CAST(MAX(CAST(${appMetaTable.value} AS INTEGER), COALESCE((SELECT MAX(${ticketsTable.id}) FROM ${ticketsTable}), 0)) + 1 AS TEXT)`,
				updatedAt
			}
		})
		.returning({ value: appMetaTable.value });
	const ticketId = Number(rows[0]?.value);

	if (!Number.isSafeInteger(ticketId) || ticketId < 1) {
		throw new Error("Failed to reserve a valid ticket ID.");
	}

	return ticketId;
}

/*
Ticket-Bot is licensed under the GNU Affero General Public License,
version 3 only ("AGPL-3.0-only"). See LICENSE.md for the full license text.

Additional Term under GNU AGPL v3, Section 7(b):

You are required to preserve and display, in a location clearly visible
to end users interacting with the bot (such as bot embeds, the bot's
"Bio" Discord profile, status, or equivalent), a notice that the
software is powered by Ticket-Bot, including a link to the original
project repository or to its website.

This notice must not be removed, obscured, or replaced.
*/
