# Use lightweight Python image
FROM python:3.11-slim

# Install git (for code analysis)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy dependency list and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy code
COPY . .

# Set Python path
ENV PYTHONPATH="${PYTHONPATH}:/app:/app/src"

# No default project directory mount point needed, user will explicitly set project path

# Run MCP tool
# MCP server uses stdio mode by default
ENTRYPOINT ["python", "-m", "code_index_mcp.server"]
