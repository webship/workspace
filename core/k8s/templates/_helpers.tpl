{{- define "ws.name" -}}{{ .Release.Name | trunc 63 | trimSuffix "-" }}{{- end -}}
{{- define "ws.labels" -}}
app.kubernetes.io/name: webship-workspace
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end -}}
{{- define "ws.selector" -}}
app.kubernetes.io/name: webship-workspace
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "ws.claim" -}}{{ .Values.workspace.persistence.existingClaim | default (printf "%s-workspace" (include "ws.name" .)) }}{{- end -}}
{{- define "ws.allowedHosts" -}}{{ list .Values.ingress.host .Values.allowedHosts | compact | join "," }}{{- end -}}
