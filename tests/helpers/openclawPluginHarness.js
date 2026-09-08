import register from '../../plugin.js';

function loadPluginTools(context = { agentId: 'test-user', sessionKey: 'test-session' }) {
  const registrations = [];
  const api = {
    config: {},
    pluginConfig: {
      autoStart: false,
      url: 'http://camofox.test',
    },
    log: {
      info() {},
      error() {},
    },
    registerTool(factory, options) {
      registrations.push({ factory, options });
    },
    registerCommand() {},
  };

  register(api);

  return Object.fromEntries(registrations.map(({ factory, options }) => {
    const definition = typeof factory === 'function' ? factory(context) : factory;
    return [options?.name || definition.name, definition];
  }));
}

export { loadPluginTools };
