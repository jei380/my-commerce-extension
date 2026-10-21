import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Cell,
  Column,
  Heading,
  InlineAlert,
  ProgressCircle,
  Provider,
  Row,
  TableBody,
  TableHeader,
  TableView,
  Text,
} from "@react-spectrum/s2";

const ACTION_URL =
  "https://3967933-237champagnecicada-stage.adobeioruntime.net/api/v1/web/course-labs/get-enriched-orders";

const numberFormatter = new Intl.NumberFormat("en-US");
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatCurrency(value, currency = "USD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "—";
  }

  if (currency === "USD") {
    return currencyFormatter.format(amount);
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatProcessedAt(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Dashboard for enriched orders processed by the Commerce event consumer. */
export function MainPage() {
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(ACTION_URL, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || `API returned ${response.status}`);
        }
        if (!data || !Array.isArray(data.orders) || !data.summary) {
          throw new Error("The Runtime action returned an unexpected response.");
        }

        setOrders(data.orders);
        setSummary(data.summary);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadDashboard();
    return () => controller.abort();
  }, [requestVersion]);

  return (
    <Provider colorScheme="light" background="base">
      <main className="dashboard">
        <Heading level={1}>Enriched Orders Dashboard</Heading>

        {loading ? (
          <div className="dashboard-loading" role="status">
            <ProgressCircle aria-label="Loading dashboard data" isIndeterminate />
            <Text>Loading dashboard data...</Text>
          </div>
        ) : error ? (
          <div className="dashboard-error">
            <InlineAlert variant="negative">
              <Heading level={2}>Unable to load enriched orders</Heading>
              <Text>{error}</Text>
            </InlineAlert>
            <Button onPress={() => setRequestVersion((version) => version + 1)}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <section aria-label="Order summary" className="dashboard-metrics">
              <Card variant="secondary">
                <Heading level={3}>Total Orders</Heading>
                <div className="dashboard-metric-value">
                  <Text>{numberFormatter.format(Number(summary.totalOrders) || 0)}</Text>
                </div>
              </Card>
              <Card variant="secondary">
                <Heading level={3}>Total Revenue</Heading>
                <div className="dashboard-metric-value">
                  <Text>{formatCurrency(summary.totalRevenue)}</Text>
                </div>
              </Card>
              <Card variant="secondary">
                <Heading level={3}>High Value Orders</Heading>
                <div className="dashboard-metric-value">
                  <Text>{numberFormatter.format(Number(summary.highValueCount) || 0)}</Text>
                </div>
              </Card>
            </section>

            <section aria-labelledby="processed-orders-heading">
              <Heading id="processed-orders-heading" level={2}>
                Processed Orders
              </Heading>
              {orders.length === 0 ? (
                <InlineAlert variant="informative">
                  <Text>
                    No enriched orders yet. Create orders in Commerce to generate
                    event data.
                  </Text>
                </InlineAlert>
              ) : (
                <div className="dashboard-table">
                  <TableView
                    aria-label="Enriched orders"
                    selectionMode="none"
                    density="compact"
                  >
                    <TableHeader>
                      <Column isRowHeader>Order #</Column>
                      <Column>Status</Column>
                      <Column align="end">Total</Column>
                      <Column>Tier</Column>
                      <Column align="end">Items</Column>
                      <Column>Processed</Column>
                    </TableHeader>
                    <TableBody>
                      {orders.map((order, index) => {
                        const orderId = order.orderId ?? order.incrementId;
                        return (
                          <Row
                            id={`${orderId ?? "order"}-${index}`}
                            key={`${orderId ?? "order"}-${index}`}
                          >
                            <Cell>{order.incrementId || order.orderId || "—"}</Cell>
                            <Cell>{order.status || "—"}</Cell>
                            <Cell>
                              {formatCurrency(order.grandTotal, order.currency || "USD")}
                            </Cell>
                            <Cell>{order.enrichment?.orderTier || "—"}</Cell>
                            <Cell>
                              {numberFormatter.format(
                                Number(
                                  order.enrichment?.itemSummary?.length ??
                                    order.itemCount ??
                                    0
                                ) || 0
                              )}
                            </Cell>
                            <Cell>{formatProcessedAt(order.processedAt)}</Cell>
                          </Row>
                        );
                      })}
                    </TableBody>
                  </TableView>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </Provider>
  );
}