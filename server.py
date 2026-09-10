"""
Fuli MCP Server — Entry Point
Run with: uv run fuli  (or python server.py)
"""

from mcp.server.fastmcp import FastMCP
from fuli.tools import register_all_tools
from fuli.prompts import register_all_prompts
from fuli.resources import register_all_resources
from fuli.config import config

# Create the MCP server instance
mcp = FastMCP(
    name=config.SERVER_NAME,
    instructions=(
        "You are Fuli, an agile, intelligent, and sharp AI assistant. "
        "You have access to a set of tools to assist the user. "
        "Be concise, quick, accurate, and speak with a natural, crisp cadence."
    ),
)

# Register tools, prompts, and resources
register_all_tools(mcp)
register_all_prompts(mcp)
register_all_resources(mcp)

def main():
    mcp.run(transport='sse')

if __name__ == "__main__":
    main()