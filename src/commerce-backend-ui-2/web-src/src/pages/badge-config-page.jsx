import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Heading,
  InlineAlert,
  ProgressCircle,
  Provider,
  Text,
} from "@react-spectrum/s2";

const ACTION_URL =
  "https://3967933-237champagnecicada-stage.adobeioruntime.net/api/v1/web/course-labs/badge-config";

const EMPTY_TIERS = [
  { percentage: "", badgeText: "" },
  { percentage: "", badgeText: "" },
  { percentage: "", badgeText: "" },
];

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeTiers(tiers = []) {
  return [0, 1, 2].map((index) => ({
    percentage: String(tiers[index]?.percentage ?? ""),
    badgeText: String(tiers[index]?.badgeText ?? ""),
  }));
}

function validateTiers(tiers) {
  const errors = [];
  const parsed = tiers.map((tier, index) => {
    const row = index + 1;
    const percentage = Number(tier.percentage);
    const badgeText = tier.badgeText.trim();

    if (!Number.isFinite(percentage)) {
      errors.push(`Tier ${row}: percentage must be a number.`);
    } else if (percentage <= 0 || percentage > 100) {
      errors.push(`Tier ${row}: percentage must be between 1 and 100.`);
    }

    if (!badgeText) {
      errors.push(`Tier ${row}: badge text is required.`);
    }

    return {
      percentage,
      badgeText,
    };
  });

  const percentages = parsed.map((tier) => tier.percentage);
  const uniquePercentages = new Set(percentages);

  if (uniquePercentages.size !== percentages.length) {
    errors.push("Percentages must be unique.");
  }

  for (let index = 1; index < percentages.length; index += 1) {
    if (percentages[index] <= percentages[index - 1]) {
      errors.push("Percentages must be in strictly ascending order.");
      break;
    }
  }

  return {
    parsed,
    errors,
  };
}

/** Configuration page for badge thresholds and texts. */
export function BadgeConfigPage() {
  const [tiers, setTiers] = useState(EMPTY_TIERS);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [source, setSource] = useState("default");
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [requestVersion, setRequestVersion] = useState(1);

  useEffect(() => {
    const controller = new AbortController();

    async function loadConfig() {
      setLoading(true);
      setError(null);
      setSuccess(null);

      try {
        const response = await fetch(ACTION_URL, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || `API returned ${response.status}`);
        }

        if (!data || !Array.isArray(data.tiers)) {
          throw new Error("The Runtime action returned an unexpected response.");
        }

        setTiers(normalizeTiers(data.tiers));
        setUpdatedAt(data.updatedAt || null);
        setSource(data.source || "state");
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

    void loadConfig();
    return () => controller.abort();
  }, [requestVersion]);

  function updateTier(index, key, value) {
    setTiers((previous) => previous.map((tier, tierIndex) => (
      tierIndex === index ? { ...tier, [key]: value } : tier
    )));
  }

  async function saveConfig() {
    setError(null);
    setSuccess(null);

    const { parsed, errors } = validateTiers(tiers);
    if (errors.length > 0) {
      setError(errors.join(" "));
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(ACTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ config: parsed }),
      });

      const data = await response.json();

      if (!response.ok) {
        const validationDetails = Array.isArray(data?.details)
          ? ` ${data.details.join(" ")}`
          : "";
        throw new Error((data?.error || `API returned ${response.status}`) + validationDetails);
      }

      setTiers(normalizeTiers(data.tiers));
      setUpdatedAt(data.updatedAt || new Date().toISOString());
      setSource("state");
      setSuccess("Badge configuration saved.");
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Provider colorScheme="light" background="base">
      <main
        className="dashboard"
        style={{
          width: "100%",
          maxWidth: "1200px",
          marginInline: 0,
        }}
      >
        <Heading level={1}>Badge Configuration</Heading>
        <Text>
          Set three discount thresholds and badge texts used by the product badging action.
        </Text>

        {loading ? (
          <div className="dashboard-loading" role="status">
            <ProgressCircle aria-label="Loading badge configuration" isIndeterminate />
            <Text>Loading badge configuration...</Text>
          </div>
        ) : error ? (
          <div className="dashboard-error">
            <InlineAlert variant="negative">
              <Heading level={2}>Unable to load badge configuration</Heading>
              <Text>{error}</Text>
            </InlineAlert>
            <Button onPress={() => setRequestVersion((version) => version + 1)}>
              Try again
            </Button>
          </div>
        ) : (
          <section
            aria-label="Badge tiers"
            style={{ width: "100%", maxWidth: "960px" }}
          >
            {error ? (
              <InlineAlert variant="negative">
                <Text>{error}</Text>
              </InlineAlert>
            ) : null}

            {success ? (
              <InlineAlert variant="positive">
                <Text>{success}</Text>
              </InlineAlert>
            ) : null}

            <div style={{ width: "100%", minWidth: 0, display: "block" }}>
              <Card variant="secondary" style={{ width: "100%", display: "block" }}>
                <div style={{ display: "grid", gap: "16px", width: "100%" }}>
                  {tiers.map((tier, index) => {
                    const tierLabel = `Tier ${index + 1}`;
                    return (
                      <div
                        key={tierLabel}
                        style={{
                          display: "grid",
                          gap: "10px",
                          alignItems: "center",
                          gridTemplateColumns: "180px minmax(0, 1fr)",
                          width: "100%",
                        }}
                      >
                        <label htmlFor={`percentage-${index}`}>
                          <Text>{`${tierLabel} %`}</Text>
                        </label>
                        <input
                          id={`percentage-${index}`}
                          type="number"
                          min="1"
                          max="100"
                          step="1"
                          value={tier.percentage}
                          onChange={(event) => updateTier(index, "percentage", event.target.value)}
                          style={{
                            width: "100%",
                            minWidth: 0,
                            minHeight: "34px",
                            boxSizing: "border-box",
                          }}
                        />

                        <label htmlFor={`badge-text-${index}`}>
                          <Text>{`${tierLabel} text`}</Text>
                        </label>
                        <input
                          id={`badge-text-${index}`}
                          type="text"
                          value={tier.badgeText}
                          onChange={(event) => updateTier(index, "badgeText", event.target.value)}
                          style={{
                            width: "100%",
                            minWidth: 0,
                            minHeight: "34px",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>

            <div style={{ marginTop: "16px", display: "flex", gap: "12px" }}>
              <Button
                variant="primary"
                onPress={saveConfig}
                isPending={saving}
                isDisabled={saving}
              >
                Save badge configuration
              </Button>
              <Button
                variant="secondary"
                onPress={() => setRequestVersion((version) => version + 1)}
                isDisabled={saving}
              >
                Reload
              </Button>
            </div>

            <Text>
              {`Source: ${source}${updatedAt ? ` • Last saved: ${new Date(updatedAt).toLocaleString()}` : ""}`}
            </Text>
          </section>
        )}
      </main>
    </Provider>
  );
}