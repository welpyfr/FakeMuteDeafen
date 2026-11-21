/*
 * FakeMuteDeafen, a community userplugin for Equicord.
 * Desktop port of the "Fake Mute & Deafen" plugin for the Valenced client mod
 * by coder.gg (https://github.com/il1ll).
 *
 * Look muted or deafened to others while you can still talk and hear.
 *
 * Core mechanism (same as the original): the outgoing gateway VOICE_STATE_UPDATE (op 4)
 * is intercepted and its self_mute/self_deaf flags are faked, while the local audio state
 * stays untouched — so the mic keeps working and audio keeps playing.
 *
 * Copyright (c) 2026 welpy
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addUserAreaButton, removeUserAreaButton, UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import { MediaEngineStore, SelectedChannelStore, showToast, UserStore, VoiceStateStore } from "@webpack/common";

const logger = new Logger("FakeMuteDeafen");

/** Gateway op code: VOICE_STATE_UPDATE */
const VOICE_STATE_UPDATE = 4;

const MUTE_BUTTON_ID = "FakeMuteDeafen.mute";
const DEAFEN_BUTTON_ID = "FakeMuteDeafen.deafen";

interface VoiceStatePayload {
    channel_id?: string | null;
    guild_id?: string | null;
    self_mute?: boolean;
    self_deaf?: boolean;
    self_video?: boolean;
    flags?: number;
    [key: string]: unknown;
}

interface GatewaySocket {
    send(op: number, data: VoiceStatePayload, ...args: unknown[]): unknown;
}

interface GatewayModule {
    getSocket(): GatewaySocket | null;
}

// Discord's current mic/headphone icon paths + the standard red slash overlay
const MIC_PATH = "M12 3a1 1 0 0 0-1-1h-.06a1 1 0 0 0-.74.32L5.92 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.92l4.28 4.68a1 1 0 0 0 .74.32H11a1 1 0 0 0 1-1V3ZM15.1 20.75c-.58.14-1.1-.33-1.1-.92v-.03c0-.5.37-.92.85-1.05a7 7 0 0 0 0-13.5A1.11 1.11 0 0 1 14 4.2v-.03c0-.6.52-1.06 1.1-.92a9 9 0 0 1 0 17.5Z";
const HEADPHONES_PATH = "M12 3a9 9 0 0 0-8.95 10h1.87a5 5 0 0 1 4.1 2.13l1.37 1.97a3.1 3.1 0 0 1-.17 3.78 2.85 2.85 0 0 1-3.55.74 11 11 0 1 1 10.66 0c-1.27.71-2.73.23-3.55-.74a3.1 3.1 0 0 1-.17-3.78l1.38-1.97a5 5 0 0 1 4.1-2.13h1.86A9 9 0 0 0 12 3Z";
const RED_LINE_PATH = "M22.7 2.7a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4Z";
const SLASH_CUT_PATH = "M23.27 4.73 19.27 .73 -.27 20.27 3.73 24.27Z";

let syncing = false;
let gatewayModule: GatewayModule | null = null;
let socketOwner: Record<string, any> | null = null;
let originalSend: ((this: unknown, op: number, data: VoiceStatePayload, ...args: unknown[]) => unknown) | null = null;
let lastVoiceState: VoiceStatePayload | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const settings = definePluginSettings({
    fakeMute: {
        type: OptionType.BOOLEAN,
        description: "Others see you muted, but you can still talk",
        default: false,
        onChange: () => onFakeSettingChanged("fakeMute")
    },
    fakeDeafen: {
        type: OptionType.BOOLEAN,
        description: "Others see you deafened (and muted), but you can still hear",
        default: false,
        onChange: () => onFakeSettingChanged("fakeDeafen")
    }
});

function ownerOf(target: Record<string, any> | null, key: string): Record<string, any> | null {
    let current = target;
    while (current && current !== Object.prototype) {
        if (Object.hasOwn(current, key)) return current;
        current = Object.getPrototypeOf(current);
    }
    return null;
}

function applyFake(payload: VoiceStatePayload): VoiceStatePayload {
    const { fakeMute, fakeDeafen } = settings.store;
    if (!fakeMute && !fakeDeafen) return payload;

    const faked = { ...payload };
    if (fakeDeafen) {
        faked.self_deaf = true;
        faked.self_mute = true;
    } else if (fakeMute) faked.self_mute = true;
    return faked;
}

function getGatewayModule(): GatewayModule | null {
    try {
        const mod = findByProps("getSocket") as GatewayModule | undefined;
        return mod && typeof mod.getSocket === "function" ? mod : null;
    } catch {
        return null;
    }
}

function patchGateway(): boolean {
    const mod = getGatewayModule();
    if (!mod) return false;

    const socket = mod.getSocket();
    if (!socket || typeof socket.send !== "function") return false;

    // patch the owner of `send` (usually the Socket prototype), so the hook
    // survives gateway reconnects, which replace the socket instance
    const owner = ownerOf(socket as unknown as Record<string, any>, "send");
    if (!owner) {
        logger.error("Gateway socket has no send method on its prototype chain");
        return true; // don't keep retrying
    }

    const original = owner.send;
    owner.send = function (this: unknown, op: number, data: VoiceStatePayload, ...rest: unknown[]) {
        if (op === VOICE_STATE_UPDATE && data && typeof data === "object") {
            // remember the real voice state so it can be replayed when the fake state is toggled
            lastVoiceState = { ...data };
            return original.apply(this, [op, applyFake(data), ...rest]);
        }
        return original.apply(this, [op, data, ...rest]);
    };

    gatewayModule = mod;
    socketOwner = owner;
    originalSend = original;
    logger.info("Gateway socket patched");
    return true;
}

function getMyVoiceState() {
    const id = UserStore.getCurrentUser()?.id;
    return id ? VoiceStateStore.getVoiceStateForUser(id) : undefined;
}

function buildRealVoiceStatePayload(): VoiceStatePayload | null {
    const channelId = lastVoiceState?.channel_id ?? SelectedChannelStore.getVoiceChannelId();
    if (!channelId) return null;

    return {
        ...(lastVoiceState ?? {}),
        guild_id: lastVoiceState?.guild_id ?? getMyVoiceState()?.guildId ?? null,
        channel_id: channelId,
        self_mute: MediaEngineStore.isSelfMute(),
        self_deaf: MediaEngineStore.isSelfDeaf(),
        self_video: lastVoiceState?.self_video ?? false,
        flags: lastVoiceState?.flags ?? 0
    };
}

/** Replay the voice state update so the server picks up the current fake state (goes through the patched send) */
function resendVoiceState() {
    if (!originalSend) return;
    const socket = gatewayModule?.getSocket();
    const payload = buildRealVoiceStatePayload();
    if (!socket || !payload) return;

    try {
        socket.send(VOICE_STATE_UPDATE, payload);
    } catch (e) {
        logger.error("Failed to resend voice state", e);
    }
}

/** Send the REAL voice state (bypasses the fake hook), used when the plugin is disabled */
function restoreRealVoiceState() {
    if (!originalSend || !gatewayModule) return;
    const socket = gatewayModule.getSocket();
    const payload = buildRealVoiceStatePayload();
    if (!socket || !payload) return;

    try {
        originalSend.call(socket, VOICE_STATE_UPDATE, payload);
    } catch (e) {
        logger.error("Failed to restore voice state", e);
    }
}

function toastFake(label: string, value: boolean) {
    showToast({
        text: `${label} ${value ? "on" : "off"}`,
        variant: value ? "success" : "critical",
        duration: 3000,
        position: "bottom"
    });
}

/** Settings-panel toggle: toast + sync the server state (no special-case handling needed here) */
function onFakeSettingChanged(key: "fakeMute" | "fakeDeafen") {
    if (syncing) return;
    toastFake(key === "fakeMute" ? "Fake mute" : "Fake deafen", settings.store[key]);
    resendVoiceState();
}

/**
 * Button toggle, with the original plugin's semantics:
 * turning "Fake Mute" off while "Fake Deafen" is on clears both ("Fake mute & deafen off").
 */
function setFake(key: "fakeMute" | "fakeDeafen", value: boolean) {
    const store = settings.store;
    const clearsBoth = key === "fakeMute" && !value && store.fakeDeafen;
    const label = clearsBoth ? "Fake mute & deafen" : key === "fakeMute" ? "Fake mute" : "Fake deafen";

    syncing = true;
    try {
        if (clearsBoth) store.fakeDeafen = false;
        store[key] = value;
    } finally {
        syncing = false;
    }

    toastFake(label, value);
    resendVoiceState();
}

function SlashableIcon({ active, className, path, maskId }: { active: boolean; className?: string; path: string; maskId: string; }) {
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24">
            <path
                fill={active ? "var(--status-danger)" : "currentColor"}
                mask={active ? `url(#${maskId})` : void 0}
                d={path}
            />
            {active && <>
                <path fill="var(--status-danger)" d={RED_LINE_PATH} />
                <mask id={maskId}>
                    <rect fill="white" x="0" y="0" width="24" height="24" />
                    <path fill="black" d={SLASH_CUT_PATH} />
                </mask>
            </>}
        </svg>
    );
}

function FakeMuteButton({ nameplate, iconForeground }: UserAreaRenderProps) {
    const { fakeMute, fakeDeafen } = settings.use(["fakeMute", "fakeDeafen"]);
    const active = fakeMute || fakeDeafen;

    return (
        <UserAreaButton
            tooltipText={active ? "Disable Fake Mute" : "Enable Fake Mute"}
            icon={<SlashableIcon active={active} className={iconForeground} path={MIC_PATH} maskId="fmd-mic-slash" />}
            role="switch"
            aria-checked={active}
            redGlow={active}
            plated={nameplate != null}
            onClick={() => setFake("fakeMute", !active)}
        />
    );
}

function FakeDeafenButton({ nameplate, iconForeground }: UserAreaRenderProps) {
    const { fakeDeafen } = settings.use(["fakeDeafen"]);

    return (
        <UserAreaButton
            tooltipText={fakeDeafen ? "Disable Fake Deafen" : "Enable Fake Deafen"}
            icon={<SlashableIcon active={fakeDeafen} className={iconForeground} path={HEADPHONES_PATH} maskId="fmd-deafen-slash" />}
            role="switch"
            aria-checked={fakeDeafen}
            redGlow={fakeDeafen}
            plated={nameplate != null}
            onClick={() => setFake("fakeDeafen", !fakeDeafen)}
        />
    );
}

export default definePlugin({
    name: "FakeMuteDeafen",
    description: "Appear muted or deafened to others while you can still talk and hear",
    tags: ["Utility", "Voice"],
    authors: [{ name: "welpy", id: 1188870867686527152n }],
    dependencies: ["UserAreaAPI"],
    settings,

    start() {
        addUserAreaButton(MUTE_BUTTON_ID, props => <FakeMuteButton {...props} />);
        addUserAreaButton(DEAFEN_BUTTON_ID, props => <FakeDeafenButton {...props} />);

        // the gateway socket may not exist yet when the plugin starts — retry for up to a minute
        let attempts = 0;
        const tryPatch = () => {
            retryTimer = null;
            if (originalSend || patchGateway()) return;
            if (++attempts >= 30) {
                logger.error("Gateway socket not found after 30 attempts; fake mute/deafen will not work");
                return;
            }
            retryTimer = setTimeout(tryPatch, 2000);
        };
        tryPatch();
    },

    stop() {
        if (retryTimer !== null) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }

        removeUserAreaButton(MUTE_BUTTON_ID);
        removeUserAreaButton(DEAFEN_BUTTON_ID);

        // let the server know our real voice state so we don't stay fake muted/deafened
        restoreRealVoiceState();

        if (socketOwner && originalSend) {
            socketOwner.send = originalSend;
        }

        gatewayModule = null;
        socketOwner = null;
        originalSend = null;
        lastVoiceState = null;
    }
});
