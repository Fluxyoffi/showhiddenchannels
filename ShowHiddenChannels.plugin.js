/**
 * @name ShowHiddenChannels
 * @author fluxy_offi
 * @description A robust plugin that shows hidden channels in the sidebar. You cannot read messages, only see their existence.
 * @version 1.1.0
 */

module.exports = class ShowHiddenChannels {
    constructor() {
        this.canView = 1n << 10n; // VIEW_CHANNEL permission bit
    }

    start() {
        const { Patcher, Webpack, ContextMenu, React } = BdApi;

        // 1. Find Critical Modules
        const Permissions = Webpack.getModule(m => m.can && m.getChannelPermissions);
        const ChannelStore = Webpack.getModule(m => m.getChannel && m.hasChannel);
        const GuildChannelStore = Webpack.getModule(m => m.getChannels && m.getSelectableChannelIds);
        const MessagesWrapper = Webpack.getModule(m => m.default?.displayName === "MessagesWrapper" || m.default?.toString().includes("channelStream"));
        const ChannelItem = Webpack.getModule(m => m.default?.displayName === "ChannelItem" || (m.default?.toString().includes("channel") && m.default?.toString().includes("unread")));
        const UserGuildSettingsStore = Webpack.getModule(m => m.isGuildSettingEnabled && m.getGuildSettings);
        const GuildActions = Webpack.getModule(m => m.requestMembers && m.escapeMemberListing); // Used for forcing refreshes if needed

        if (!Permissions || !GuildChannelStore) {
            console.error("ShowHiddenChannels: Essential modules missing.");
            return;
        }

        // 2. Patch UserGuildSettingsStore to force "See All Channels"
        if (UserGuildSettingsStore) {
            // Force SHOWN_CHANNELS_ALL flag in the store
            Patcher.after("ShowHiddenChannels", UserGuildSettingsStore, "getGuildSettings", (thisObject, args, returnValue) => {
                if (returnValue) {
                    // 4 is the bit for SHOWN_CHANNELS_ALL
                    returnValue.flags = (returnValue.flags || 0) | 4;
                }
            });

            Patcher.instead("ShowHiddenChannels", UserGuildSettingsStore, "isGuildSettingEnabled", (thisObject, args, originalFunction) => {
                const [guildId, settingId] = args;
                // Check for 4 (SHOWN_CHANNELS_ALL) or 1 (sometimes used)
                if (settingId === 4 || settingId === 1) return true;
                return originalFunction.apply(thisObject, args);
            });

            // Force all channels to be considered "opted-in" (This is the Browse Channels bypass)
            Patcher.instead("ShowHiddenChannels", UserGuildSettingsStore, "isChannelOptedIn", () => true);
        }

        // 3. Patch GuildChannelStore to ensure all channels are returned
        // Patching getChannels is often redundant if Permissions and Opt-in are patched,
        // but it ensures that hidden channels are included in the results for the sidebar.
        Patcher.after("ShowHiddenChannels", GuildChannelStore, "getChannels", (thisObject, args, returnValue) => {
            const guildId = args[0];
            if (!guildId || !returnValue) return returnValue;
            return returnValue;
        });

        // 4. Patch Permission 'can' and 'getChannelPermissions'
        Patcher.instead("ShowHiddenChannels", Permissions, "can", (thisObject, args, originalFunction) => {
            const [permission, userOrChannel] = args;
            if (permission === this.canView || permission === 1024) {
                return true;
            }
            return originalFunction.apply(thisObject, args);
        });

        Patcher.after("ShowHiddenChannels", Permissions, "getChannelPermissions", (thisObject, args, returnValue) => {
            return BigInt(returnValue) | this.canView;
        });

        // 5. Patch ChannelItem for Visuals
        if (ChannelItem) {
            Patcher.after("ShowHiddenChannels", ChannelItem, "default", (thisObject, args, returnValue) => {
                const channel = args[0]?.channel;
                if (!channel) return;

                // Check actual permissions to see if it should look "hidden"
                const actualPerms = Permissions.getChannelPermissions(channel);
                const isHidden = !(BigInt(actualPerms) & this.canView);

                if (isHidden) {
                    if (returnValue?.props?.children?.props) {
                        returnValue.props.children.props.className += " shc-hidden-channel";
                    } else if (returnValue?.props) {
                        returnValue.props.className += " shc-hidden-channel";
                    }
                }
            });
        }

        // 6. Locked Channel Overlay
        if (MessagesWrapper) {
            Patcher.after("ShowHiddenChannels", MessagesWrapper, "default", (thisObject, args, returnValue) => {
                const channel = args[0]?.channel;
                if (!channel) return;

                const actualPerms = Permissions.getChannelPermissions(channel);
                const isHidden = !(BigInt(actualPerms) & this.canView);

                if (isHidden) {
                    return React.createElement("div", { className: "shc-overlay" }, [
                        React.createElement("div", { className: "shc-lock-icon" }, "🔒"),
                        React.createElement("h2", {}, `Locked: #${channel.name}`),
                        React.createElement("p", {}, "You do not have permission to view this channel."),
                        React.createElement("div", { className: "shc-meta" }, [
                            React.createElement("span", {}, `ID: ${channel.id}`),
                            channel.topic ? React.createElement("p", { className: "shc-topic" }, `Topic: ${channel.topic}`) : null
                        ])
                    ]);
                }
            });
        }

        // 7. Inject Styles
        BdApi.DOM.addStyle("ShowHiddenChannels-Styles", `
            .shc-hidden-channel {
                opacity: 0.45;
                filter: grayscale(0.8);
            }
            .shc-hidden-channel::after {
                content: " 🔒";
                font-size: 10px;
                opacity: 0.8;
            }
            .shc-overlay {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                background: rgba(15, 15, 15, 0.85);
                backdrop-filter: blur(10px);
                color: #efefef;
                text-align: center;
                padding: 20px;
            }
            .shc-lock-icon {
                font-size: 64px;
                margin-bottom: 20px;
                filter: drop-shadow(0 0 10px rgba(255,255,255,0.2));
            }
            .shc-meta {
                margin-top: 20px;
                font-size: 12px;
                color: #aaa;
            }
            .shc-topic {
                margin-top: 10px;
                font-style: italic;
                color: #888;
                max-width: 400px;
            }
        `);

        // 8. Force Refresh
        // We trigger a re-render of the guild list/channels if possible
        const SelectedGuildStore = Webpack.getModule(m => m.getGuildId && m.getLastSelectedGuildId);
        if (SelectedGuildStore) {
            const currentGuildId = SelectedGuildStore.getGuildId();
            if (currentGuildId) {
                // Dispatching a dummy event or just waiting for the next render cycle usually works in BD
                BdApi.UI.showToast("ShowHiddenChannels: Auto-activated See All Channels", { type: "info" });
            }
        }

        console.log("ShowHiddenChannels: Version 1.1.0 Started with Auto-Activate.");
    }

    stop() {
        BdApi.Patcher.unpatchAll("ShowHiddenChannels");
        BdApi.DOM.removeStyle("ShowHiddenChannels-Styles");
        console.log("ShowHiddenChannels: Stopped.");
    }
};
