/**
 * @name ShowHiddenChannels
 * @author Antigravity
 * @description A plugin that shows hidden channels in the sidebar. You cannot read messages, only see their existence.
 * @version 1.0.0
 */

module.exports = class ShowHiddenChannels {
    constructor() {
        this.canView = 1n << 10n; // VIEW_CHANNEL permission bit
    }

    start() {
        const { Patcher, Webpack, ContextMenu } = BdApi;

        // 1. Find Permission Modules
        const Permissions = Webpack.getModule(m => m.can && m.getChannelPermissions);
        const ChannelStore = Webpack.getModule(m => m.getChannel && m.hasChannel);
        
        if (!Permissions) {
            console.error("ShowHiddenChannels: Could not find Permissions module.");
            return;
        }

        // 2. Patch 'can' function to always return true for VIEW_CHANNEL
        Patcher.instead("ShowHiddenChannels", Permissions, "can", (thisObject, args, originalFunction) => {
            const [permission, userOrChannel] = args;
            
            // If checking for VIEW_CHANNEL, force true
            if (permission === this.canView || permission === 1024) {
                return true;
            }
            
            return originalFunction.apply(thisObject, args);
        });

        // 3. Patch Channel Sidebar to show "Hidden" status or Lock icon
        const ChannelItem = Webpack.getModule(m => m.default?.displayName === "ChannelItem");
        if (ChannelItem) {
            Patcher.after("ShowHiddenChannels", ChannelItem, "default", (thisObject, args, returnValue) => {
                const channel = args[0].channel;
                if (!channel) return;

                // Check if the channel is actually hidden from the user normally
                const actualPermissions = Permissions.getChannelPermissions(channel);
                const isHidden = !(BigInt(actualPermissions) & this.canView);

                if (isHidden) {
                    // Add a custom class or style to visually distinguish it
                    const children = returnValue.props.children;
                    if (children && children.props) {
                        children.props.className += " shc-hidden-channel";
                        // We could also inject a Lock icon here if we wanted to get fancy with React
                    }
                }
            });
        }

        // 4. Inject some basic styles
        BdApi.DOM.addStyle("ShowHiddenChannels-Styles", `
            .shc-hidden-channel {
                opacity: 0.6;
                filter: grayscale(1);
            }
            .shc-hidden-channel::after {
                content: " 🔒";
                font-size: 10px;
                vertical-align: middle;
            }
        `);

        console.log("ShowHiddenChannels: Started.");
    }

    stop() {
        BdApi.Patcher.unpatchAll("ShowHiddenChannels");
        BdApi.DOM.removeStyle("ShowHiddenChannels-Styles");
        console.log("ShowHiddenChannels: Stopped.");
    }
};
