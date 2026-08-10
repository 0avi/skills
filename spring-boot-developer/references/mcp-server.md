# MCP Server

Exposing your application's capabilities to AI clients (Claude Code, Claude Desktop, other MCP hosts) over the Model Context Protocol.

Use the **Spring AI MCP starter** rather than driving the standalone Java SDK - it auto-configures the server, the transport and annotation-based tool scanning. The SDK directly is for a non-Spring application.

## Transport

Pick one; they are different starters and different deployment models.

| Transport | Starter | Use when |
|---|---|---|
| **stdio** | `spring-ai-starter-mcp-server` | The client launches your jar as a local subprocess - Claude Code, Claude Desktop on the same machine |
| **Streamable HTTP** | `spring-ai-starter-mcp-server-webmvc` | Remote server, multiple clients, normal deployment |

```xml
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-mcp-server-webmvc</artifactId>
</dependency>
```

The pre-1.0 name `spring-ai-mcp-server-spring-boot-starter` is dead.

```yaml
spring:
  ai:
    mcp:
      server:
        name: order-service-mcp
        version: 1.0.0
        protocol: STREAMABLE      # remote; prefer over legacy SSE
```

## stdio: keep stdout clean

On stdio the protocol **is** stdin/stdout. Any banner, log line or stray `System.out.println` corrupts the JSON-RPC framing and the client drops the connection with no useful error.

```yaml
spring:
  main:
    banner-mode: off
logging:
  file:
    name: /var/log/order-mcp.log     # anywhere but stdout
  pattern:
    console:                          # empty - disable console appender
```

This is the single most common reason a stdio server "doesn't work".

## Tools

```java
@Component
class OrderMcpTools {

    private final OrderService orderService;

    OrderMcpTools(OrderService orderService) {
        this.orderService = orderService;
    }

    @McpTool(
            name = "get_order",
            description = """
                    Retrieve a single order by its id, including line items and current status.
                    Use when the user asks about a specific known order. To find an order without \
                    an id, use list_orders instead.""")
    OrderResponse getOrder(
            @McpToolParam(description = "Order id as a UUID string", required = true)
            String orderId) {

        return orderService.getById(OrderId.of(orderId));
    }

    @McpTool(
            name = "list_orders",
            description = "List a customer's orders, optionally filtered by status. Returns at most 50.")
    List<OrderResponse> listOrders(
            @McpToolParam(description = "Customer email address", required = true) String email,
            @McpToolParam(description = "One of: DRAFT, PLACED, SHIPPED, DELIVERED, CANCELLED",
                          required = false) String status) {

        return orderService.findForCustomer(email, status, Limit.of(50));
    }
}
```

- `@McpTool` and `@McpToolParam` are the MCP server annotations. `@Tool` is Spring AI's *model* tool-calling API - a different mechanism. Do not mix them in one server.
- Annotated `@Component` methods are discovered automatically. Do not also register a `MethodToolCallbackProvider` for the same methods.

### The description is the prompt

A tool description is not documentation - it is the text the model reads to decide whether to call your tool. Vague descriptions produce tools that are never called, or called for the wrong thing.

State **what it returns, when to call it, and when not to**. The `get_order` example above points at `list_orders` for the case it does not handle; that one sentence prevents a whole class of wrong calls.

Same for parameters: `"One of: DRAFT, PLACED, …"` is a usable description; `"the status"` is not.

### Return DTOs, keep tools bounded

Return response records, never entities - an entity serialises lazy proxies, leaks your schema, and can throw outside the transaction ([spring-data-jpa.md](spring-data-jpa.md)).

**Bound every result.** A tool that can return ten thousand rows will, and it will fill the model's context window with them. Cap the result, say the cap in the description, and paginate if callers need more.

Prefer a few well-named tools over many overlapping ones. A model choosing between twenty similar tools chooses badly.

## Errors

```java
@McpTool(name = "cancel_order", description = "Cancel a PENDING order. Fails if already shipped.")
CancellationResult cancelOrder(
        @McpToolParam(description = "Order id as a UUID string", required = true) String orderId) {
    try {
        orderService.cancel(OrderId.of(orderId));
        return CancellationResult.cancelled(orderId);
    } catch (OrderNotFoundException e) {
        return CancellationResult.failed("No order with id " + orderId);
    } catch (OrderNotModifiableException e) {
        return CancellationResult.failed("Order cannot be cancelled: " + e.getMessage());
    }
}
```

**Return a structured failure rather than throwing.** An exception escaping a tool handler becomes an opaque protocol-level error; a described failure lets the model understand what went wrong and adjust - usually the difference between recovering and giving up.

Make the message actionable. `"Order cannot be cancelled: already shipped"` tells the model something; `"Internal error"` does not.

Never leak a stack trace or an internal message through a tool result - the same reasoning as [error-handling.md](error-handling.md).

## Security

**An MCP tool is an API endpoint with a model as the client.** Everything in [security-fundamentals.md](security-fundamentals.md) applies, plus two things specific to this shape:

- **The model decides what to call, prompted by text you do not control.** Treat every tool argument as untrusted input. A tool that takes a raw SQL fragment, a file path or a shell argument is a vulnerability, whatever the description says.
- **Expose read tools freely; gate writes.** A destructive tool reachable by any client that connects is a bad default. Require authentication on the HTTP transport, and consider keeping genuinely destructive operations out of the tool surface entirely.

For stdio, the client already runs your process locally, so the trust boundary is the machine - but the arguments are still model-generated and still need validating.

Do not expose an MCP server publicly without authentication.

## Client configuration

```json
{
  "mcpServers": {
    "order-service": {
      "command": "java",
      "args": ["-jar", "/opt/order-mcp/order-mcp-server.jar"],
      "env": {
        "SPRING_DATASOURCE_URL": "jdbc:postgresql://localhost:5432/orders",
        "SPRING_PROFILES_ACTIVE": "mcp"
      }
    }
  }
}
```

A dedicated `mcp` profile is worth having: it turns the banner off, redirects logging, and disables anything that would write to stdout ([configuration.md](configuration.md)).

## Testing

Tools are ordinary Spring beans - test them directly:

```java
@Test
void getOrderReturnsLineItems() {
    var response = orderMcpTools.getOrder(orderId.value().toString());
    assertThat(response.lines()).hasSize(2);
}

@Test
void cancelOrderReportsFailureWhenShipped() {
    var result = orderMcpTools.cancelOrder(shippedOrderId.value().toString());
    assertThat(result.succeeded()).isFalse();
    assertThat(result.message()).contains("cannot be cancelled");
}
```

Assert the **failure** paths especially - a tool that throws instead of returning a described failure is the defect this file most warns about, and only a test catches it.

For an end-to-end check, run the server and drive it with an MCP client. Keep that out of the normal build.

## If on Boot 3.5.x

Use Spring AI **1.x** and its MCP starters. The transport model is the same, but 1.x used Spring AI's `@Tool`/`@ToolParam` with a `MethodToolCallbackProvider` rather than the native `@McpTool`/`@McpToolParam` annotations, and remote transport was configured as SSE rather than `protocol: STREAMABLE`. Check the Spring AI 1.x reference for the exact shapes - do not port the 2.0 annotations backwards.

## Gotchas

- Agent generates Python MCP code for a Java project - use the Spring AI starter
- Agent uses `spring-ai-mcp-server-spring-boot-starter` - dead name; use `spring-ai-starter-mcp-server[-webmvc]`
- Agent logs to stdout on a stdio server - corrupts JSON-RPC framing and the client silently disconnects
- Agent uses `@Tool` where `@McpTool` is needed - different mechanism; do not mix
- Agent also registers a `MethodToolCallbackProvider` for annotated methods - they are already discovered
- Agent sets `spring.ai.mcp.server.transport` for remote - it is `protocol: STREAMABLE`
- Agent writes a vague tool description - the description is the prompt; say when to call it and when not to
- Agent leaves parameters undescribed - the model has nothing to go on
- Agent returns entities - leaks the schema and triggers lazy loads
- Agent returns unbounded result sets - fills the context window; cap and say the cap
- Agent throws from a tool handler - return a structured, described failure so the model can adapt
- Agent puts an internal message or stack trace in a tool result
- Agent exposes destructive tools with no authentication - a tool is an endpoint whose client is a model
- Agent trusts tool arguments - they are model-generated from text you do not control
- Agent tests only the happy path - the failure path is where the common defect is

## Related

- [spring-ai.md](spring-ai.md) · [ai-observability.md](ai-observability.md) · [security-fundamentals.md](security-fundamentals.md) · [configuration.md](configuration.md) · [error-handling.md](error-handling.md)
