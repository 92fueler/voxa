from .openai import OpenAIProvider


def create_provider(name, config, client):
    # Fail at startup rather than silently using a different provider.
    factories = {"openai": OpenAIProvider}
    if name not in factories:
        raise ValueError(f"Unknown provider: {name}")
    return factories[name](config, client)
