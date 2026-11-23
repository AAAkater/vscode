/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../log/common/log.js';
import { ISessionDataService } from '../../common/sessionDataService.js';
import type { ModelSelection } from '../../common/state/protocol/state.js';

/** Durable identity of one Codex child thread and its spawn edge. */
export interface ICodexSubagentBinding {
	/** Exact host chat URI minted for this child. */
	readonly childChat: string;
	/** Chat that issued the spawning tool call, including nested subagent chats. */
	readonly parentChat: string;
	/** Stable title shown for the child chat. */
	readonly title: string;
	/** Host tool-call id used by the parent transcript and child routing. */
	readonly toolCallId: string;
	/** Codex child thread id. */
	readonly childThreadId: string;
	/** Codex parent thread id. */
	readonly parentThreadId: string;
	/** Native turn id that owns the spawn item. */
	readonly parentTurnId: string;
	/** Opening child prompt, title, and model copied from the collab item. */
	readonly prompt?: string;
	readonly model?: ModelSelection;
}

const bindingPrefix = 'codex.subagent.binding.';

function bindingKey(childChat: string): string {
	return `${bindingPrefix}${childChat}`;
}

function parseBinding(value: string): ICodexSubagentBinding | undefined {
	try {
		const parsed = JSON.parse(value) as Partial<ICodexSubagentBinding>;
		if (typeof parsed.childChat !== 'string'
			|| typeof parsed.title !== 'string'
			|| typeof parsed.parentChat !== 'string'
			|| typeof parsed.toolCallId !== 'string'
			|| typeof parsed.childThreadId !== 'string'
			|| typeof parsed.parentThreadId !== 'string'
			|| typeof parsed.parentTurnId !== 'string') {
			return undefined;
		}
		const model = parsed.model;
		if (model !== undefined && (typeof model !== 'object' || model === null || typeof model.id !== 'string')) {
			return undefined;
		}
		return {
			childChat: parsed.childChat,
			title: parsed.title,
			parentChat: parsed.parentChat,
			toolCallId: parsed.toolCallId,
			childThreadId: parsed.childThreadId,
			parentThreadId: parsed.parentThreadId,
			parentTurnId: parsed.parentTurnId,
			...(typeof parsed.prompt === 'string' ? { prompt: parsed.prompt } : {}),
			...(model ? { model } : {}),
		};
	} catch {
		return undefined;
	}
}

/**
 * Stores one keyed row per child chat in its owning session's database. A child can be reused without another spawn, so the row
 * preserves the original host tool-call id and its exact native location.
 */
export class CodexSubagentBindingStore {
	constructor(
		@ISessionDataService private readonly _sessionDataService: ISessionDataService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async write(storage: URI, binding: ICodexSubagentBinding): Promise<void> {
		const ref = this._sessionDataService.openDatabase(storage);
		try {
			const key = bindingKey(binding.childChat);
			await ref.object.setMetadataValuesIfAbsent(key, { [key]: JSON.stringify(binding) });
		} finally {
			ref.dispose();
		}
	}

	async read(storage: URI, childChat: string): Promise<ICodexSubagentBinding | undefined> {
		try {
			const ref = await this._sessionDataService.tryOpenDatabase(storage);
			if (!ref) {
				return undefined;
			}
			try {
				const value = await ref.object.getMetadata(bindingKey(childChat));
				const binding = value === undefined ? undefined : parseBinding(value);
				return binding?.childChat === childChat ? binding : undefined;
			} finally {
				ref.dispose();
			}
		} catch (error) {
			this._logService.warn(`[Codex] Failed to read subagent binding for ${childChat}`, error);
			return undefined;
		}
	}

	async readAll(storage: URI): Promise<readonly ICodexSubagentBinding[]> {
		try {
			const ref = await this._sessionDataService.tryOpenDatabase(storage);
			if (!ref) {
				return [];
			}
			try {
				const values = await ref.object.getMetadataByPrefix(bindingPrefix);
				const result: ICodexSubagentBinding[] = [];
				for (const [key, value] of Object.entries(values)) {
				const binding = parseBinding(value);
				if (binding && key === bindingKey(binding.childChat)) {
						result.push(binding);
					}
				}
				return result;
			} finally {
				ref.dispose();
			}
		} catch (error) {
			this._logService.warn(`[Codex] Failed to read subagent bindings for ${storage.toString()}`, error);
			return [];
		}
	}
}
