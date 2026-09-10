"""
Data resources — expose static content or dynamic data via MCP resources.
"""


def register(mcp):

    @mcp.resource("fuli://info")
    def server_info() -> str:
        """Returns basic info about this MCP server."""
        return (
            "Fuli MCP Server\n"
            "An agile, intelligent AI voice assistant and tools platform.\n"
            "Built with FastMCP."
        )
