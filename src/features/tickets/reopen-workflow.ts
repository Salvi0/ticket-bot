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

import type { APIChatInputApplicationCommandInteraction, APIMessageComponentInteraction } from "@discordjs/core";
import { MessageFlags } from "@discordjs/core";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { deferReply, editReply, reply } from "@/core/respond";
import type { BotApp, CommandExecutionContext, ComponentExecutionContext } from "@/core/types";
import { ticketsTable } from "@/db/schema";
import { sendTicketLog } from "@/features/logs/service";
import { createTicketLogContext } from "@/features/logs/utils";
import { getTicketType, hasTicketStaffAccess } from "@/features/tickets/config-access";
import { getInvitedUserIds, grantTicketParticipantAccess } from "@/features/tickets/participants";
import { findTicketByChannel } from "@/features/tickets/records";
import { syncTicketWelcomeMessage } from "@/features/tickets/ticket-workflow";
import { getInteractionUser, getMemberRoleIds } from "@/features/tickets/utils";

type ReopenInteraction = APIChatInputApplicationCommandInteraction | APIMessageComponentInteraction;

export async function executeReopenCommand(
	context: CommandExecutionContext,
	interaction: APIChatInputApplicationCommandInteraction
) {
	await reopenTicket(context.app, interaction);
}

export async function handleReopenButton(context: ComponentExecutionContext, interaction: APIMessageComponentInteraction) {
	await reopenTicket(context.app, interaction);
}

async function reopenTicket(app: BotApp, interaction: ReopenInteraction) {
	const channelId = interaction.channel_id;

	if (!channelId) {
		await reply(app, interaction, {
			content: app.LL.tickets.records.not_ticket_channel(),
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	const ticket = await findTicketByChannel(app, channelId);

	if (!ticket) {
		await reply(app, interaction, {
			content: app.LL.tickets.reopen.not_ticket(),
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	if (!ticket.closedAt) {
		await reply(app, interaction, {
			content: app.LL.tickets.reopen.only_closed(),
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	const ticketType = getTicketType(app, ticket.type);

	if (!hasTicketStaffAccess(app, ticketType, getMemberRoleIds(interaction))) {
		await reply(app, interaction, {
			content: app.LL.tickets.reopen.only_staff(),
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	await deferReply(app, interaction, { flags: MessageFlags.Ephemeral });

	const [reopenedTicket] = await app.db
		.update(ticketsTable)
		.set({
			closedAt: null,
			closedBy: null,
			closedReason: null,
			transcriptUrl: null
		})
		.where(and(eq(ticketsTable.channelId, channelId), isNotNull(ticketsTable.closedAt)))
		.returning();

	// Two staff members may use the button at almost the same time. The guarded
	// update makes the first interaction authoritative without duplicate logs.
	if (!reopenedTicket) {
		await editReply(app, interaction, {
			content: app.LL.tickets.reopen.only_closed()
		});
		return;
	}

	try {
		const participantIds = [ticket.createdBy, ...getInvitedUserIds(ticket)];
		const categoryId =
			ticket.claimedBy && app.config.tickets.claims.categoryWhenClaimed?.trim()
				? app.config.tickets.claims.categoryWhenClaimed.trim()
				: ticketType.categoryId;

		await Promise.all([
			...participantIds.map((userId) => grantTicketParticipantAccess(app, channelId, userId)),
			app.client.api.channels.edit(channelId, { parent_id: categoryId })
		]);
		await syncTicketWelcomeMessage(app, reopenedTicket, ticketType);
	} catch (error) {
		// Restore the closed record when Discord rejects a required update. This
		// avoids presenting a ticket as open while its participants cannot use it.
		await app.db
			.update(ticketsTable)
			.set({
				closedAt: ticket.closedAt,
				closedBy: ticket.closedBy,
				closedReason: ticket.closedReason,
				transcriptUrl: ticket.transcriptUrl
			})
			.where(and(eq(ticketsTable.channelId, channelId), isNull(ticketsTable.closedAt)));
		app.logger.error(`Failed to restore Discord state for ticket channel ${channelId}.`, error);
		await editReply(app, interaction, {
			content: app.LL.shared.unexpected_interaction_error()
		});
		return;
	}

	void sendTicketLog(app, {
		kind: "ticketReopen",
		actor: getInteractionUser(interaction),
		ticket: createTicketLogContext(reopenedTicket, ticketType.name)
	});

	await editReply(app, interaction, {
		content: app.LL.tickets.reopen.success()
	});
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
