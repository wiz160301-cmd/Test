import { useTranslation } from "react-i18next";
import type { SystemInfo } from "../lib/api";

interface Props {
  systemInfo: SystemInfo | null;
}

export function SystemInfoPanel({ systemInfo }: Props) {
  const { t } = useTranslation();

  return (
    <aside className="system-info-panel">
      <h2>{t("systemInfo.title")}</h2>
      {!systemInfo ? (
        <p className="system-info-panel__loading">…</p>
      ) : (
        <dl>
          <dt>{t("systemInfo.os")}</dt>
          <dd>
            {systemInfo.os} {systemInfo.os_version}
          </dd>

          <dt>{t("systemInfo.cpu")}</dt>
          <dd>{systemInfo.cpu}</dd>

          <dt>{t("systemInfo.memory")}</dt>
          <dd>
            {systemInfo.memory_used_mb} / {systemInfo.memory_total_mb} MB
          </dd>

          <dt>{t("systemInfo.disk")}</dt>
          <dd>
            {systemInfo.disk_free_gb} / {systemInfo.disk_total_gb} GB
          </dd>

          <dt>{t("systemInfo.network")}</dt>
          <dd>{systemInfo.network_connected ? "OK" : "—"}</dd>
        </dl>
      )}
    </aside>
  );
}
