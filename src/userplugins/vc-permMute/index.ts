import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { VoiceStateStore } from "@webpack/common";
import { GuildMemberStore } from "@webpack/common";
import { Menu, React, UserStore, RestAPI, ChannelStore, PermissionsBits, PermissionStore } from "@webpack/common";

interface UserSettings {
    mute: boolean;
    deaf: boolean;
    disconnect: boolean;
}

const userSettings = new Map<string, UserSettings>();

function getUserSettings(userId: string): UserSettings {
    if (!userSettings.has(userId)) {
        userSettings.set(userId, { mute: false, deaf: false, disconnect: false });
    }
    return userSettings.get(userId)!;
}

function setUserSettings(userId: string, settings: UserSettings) {
    userSettings.set(userId, settings);
}

async function disconnectGuildMember(guildId: string, userId: string) {
    try {
        const response = await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { channel_id: null }
        });
        return response.ok !== false;
    } catch {
        return false;
    }
}

async function muteGuildMember(guildId: string, userId: string, mute: boolean) {
    try {
        const response = await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { mute }
        });
        return response.ok !== false;
    } catch {
        return false;
    }
}

async function deafenGuildMember(guildId: string, userId: string, deaf: boolean) {
    try {
        const response = await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { deaf }
        });
        return response.ok !== false;
    } catch {
        return false;
    }
}

function getGuildIdFromChannel(channelId: string): string | undefined {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return undefined;
    return (channel as any).guild_id ?? (channel as any).guildId ?? undefined;
}

interface UserContextProps {
    user: any;
    guildId?: string;
}

const UserContext: NavContextMenuPatchCallback = (children, { user, guildId }: UserContextProps) => {
    if (!user || user.id === UserStore.getCurrentUser().id) return;
    if (!guildId) return; // Only work in guilds

    const settings = getUserSettings(user.id);
    const hasAnyAction = settings.disconnect || settings.mute || settings.deaf;

    children.splice(-1, 0,
        React.createElement(Menu.MenuGroup, {
            key: "perm-voice-controls-group"
        }, [
            React.createElement(Menu.MenuItem, {
                id: "perm-voice-controls-header",
                label: "Permanent Voice Controls",
                disabled: true
            }),
            React.createElement(Menu.MenuCheckboxItem, {
                id: "perm-mute",
                label: "Permanent Mute",
                checked: settings.mute,
                action: () => {
                    const newSettings = { ...settings, mute: !settings.mute };
                    setUserSettings(user.id, newSettings);
                    if (newSettings.mute) {
                        const channel = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
                        if (channel) {
                            const gId = getGuildIdFromChannel(channel);
                            if (gId) void muteGuildMember(gId, user.id, true);
                        }
                    } else if (guildId) {
                        void muteGuildMember(guildId, user.id, false);
                    }
                }
            }),
            React.createElement(Menu.MenuCheckboxItem, {
                id: "perm-deaf",
                label: "Permanent Deaf",
                checked: settings.deaf,
                action: () => {
                    const newSettings = { ...settings, deaf: !settings.deaf };
                    setUserSettings(user.id, newSettings);
                    if (newSettings.deaf) {
                        const channel = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
                        if (channel) {
                            const gId = getGuildIdFromChannel(channel);
                            if (gId) void deafenGuildMember(gId, user.id, true);
                        }
                    } else if (guildId) {
                        void deafenGuildMember(guildId, user.id, false);
                    }
                }
            }),
            React.createElement(Menu.MenuCheckboxItem, {
                id: "perm-disconnect",
                label: "Permanent Disconnect",
                checked: settings.disconnect,
                action: () => {
                    const newSettings = { ...settings, disconnect: !settings.disconnect };
                    setUserSettings(user.id, newSettings);
                    if (newSettings.disconnect) {
                        const channel = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
                        if (channel) {
                            const gId = getGuildIdFromChannel(channel);
                            if (gId) void disconnectGuildMember(gId, user.id);
                        }
                    }
                }
            })
        ])
    );
};

export default definePlugin({
    name: "Permanent Voice Controls",
    description: "Adds persistent mute, deaf, and disconnect controls to user context menu",
    authors: [Devs.Ven],

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: any[]; }) {
            try {
                for (const { userId, channelId, mute, deaf } of voiceStates) {
                    const settings = userSettings.get(userId);
                    if (!settings || (!settings.disconnect && !settings.mute && !settings.deaf)) continue;

                    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
                    if (!channel) continue;
                    const guildId = getGuildIdFromChannel(channelId!);
                    if (!guildId) continue;

                    // Check permissions
                    const canMove = PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel);
                    const canMute = PermissionStore.can(PermissionsBits.MUTE_MEMBERS, channel);
                    const canDeafen = PermissionStore.can(PermissionsBits.DEAFEN_MEMBERS, channel);

                    if (settings.disconnect && channelId && canMove) {
                        // User joined a voice channel, disconnect them
                        void disconnectGuildMember(guildId, userId);
                    }

                    // Continuously apply mute/deafen based on current voice state
                    if (settings.mute && canMute && !mute) {
                        void muteGuildMember(guildId, userId, true);
                    }
                    if (settings.deaf && canDeafen && !deaf) {
                        void deafenGuildMember(guildId, userId, true);
                    }
                }
            } catch (e) {
                console.error("vc-permMute: Error in VOICE_STATE_UPDATES:", e);
            }
        },
    },

    contextMenus: {
        "user-context": UserContext
    }
});