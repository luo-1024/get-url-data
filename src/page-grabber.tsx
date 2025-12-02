import React, { useEffect, useMemo, useState } from 'react'
import { bitable, FieldType } from '@lark-base-open/js-sdk'
import { Alert, Button, Select, Typography } from 'antd'

type FieldMeta = {
  id: string
  name: string
  type: FieldType
}

function useFields() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<FieldMeta[]>([])

  useEffect(() => {
    const fn = async () => {
      try {
        setLoading(true)
        const table = await bitable.base.getActiveTable()
        const list = await table.getFieldMetaList()
        setFields(list as FieldMeta[])
      } catch (e: any) {
        setError(e?.message || '加载字段失败')
      } finally {
        setLoading(false)
      }
    }
    fn()
  }, [])

  return { loading, error, fields }
}

function normalizeUrl(u: string) {
  if (!u) return ''
  const trimmed = u.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `http://${trimmed}`
}

async function fetchPageText(url: string) {
  const u = normalizeUrl(url)
  try {
    const res = await fetch(u)
    const ct = res.headers.get('content-type') || ''
    if (res.ok && /text\//i.test(ct)) {
      const html = await res.text()
      return html
    }
    throw new Error('CORS 或内容类型不支持')
  } catch {
    const noScheme = u.replace(/^https?:\/\//i, '')
    const readerUrl = `https://r.jina.ai/http://${noScheme}`
    const res2 = await fetch(readerUrl)
    const txt = await res2.text()
    return txt
  }
}

function summarizeFromHtmlOrText(input: string) {
  const isHtml = /<html[\s\S]*<\/html>/i.test(input) || /<body[\s\S]*<\/body>/i.test(input)
  if (isHtml) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(input, 'text/html')
    const title = doc.querySelector('title')?.textContent?.trim() || ''
    const desc = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || ''
    const headings = Array.from(doc.querySelectorAll('h1,h2,h3'))
      .map(h => h.textContent?.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(' / ')
    const firstP = doc.querySelector('p')?.textContent?.trim() || ''
    const combined = [title, desc, headings, firstP].filter(Boolean).join(' | ')
    return combined.slice(0, 500)
  }
  const text = input.replace(/\s+/g, ' ').trim()
  return text.slice(0, 500)
}

async function getFieldValueAsUrl(table: any, fieldId: string, recordId: string) {
  const val = await table.getCellValue(fieldId, recordId)
  if (!val) return ''
  if (typeof val === 'string') return normalizeUrl(val)
  if (Array.isArray(val)) {
    const first = val[0] as any
    if (!first) return ''
    if (typeof first === 'string') return normalizeUrl(first)
    const u = first.link || first.url || first.href || ''
    return normalizeUrl(u)
  }
  if (typeof val === 'object') {
    const u = (val as any).link || (val as any).url || (val as any).href || ''
    return normalizeUrl(u)
  }
  return ''
}

async function setTextFieldValue(table: any, fieldId: string, recordId: string, text: string) {
  const field = await table.getField(fieldId)
  await field.setValue(recordId, text)
}

export default function PageGrabber() {
  const { loading, error, fields } = useFields()
  const linkOptions = useMemo(() => fields.filter(f => f.type === FieldType.Url).map(f => ({ label: f.name, value: f.id })), [fields])
  const textOptions = useMemo(() => fields.filter(f => f.type === FieldType.Text).map(f => ({ label: f.name, value: f.id })), [fields])
  const [linkFieldId, setLinkFieldId] = useState<string>()
  const [textFieldId, setTextFieldId] = useState<string>()
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [errors, setErrors] = useState(0)

  const disabled = running || !linkFieldId || !textFieldId

  const grab = async () => {
    if (!linkFieldId || !textFieldId) return
    setRunning(true)
    setDone(0)
    setErrors(0)
    try {
      const table = await bitable.base.getActiveTable()
      const recordIdList = await table.getRecordIdList()
      setTotal(recordIdList.length)
      for (const recordId of recordIdList) {
        try {
          const url = await getFieldValueAsUrl(table, linkFieldId, recordId)
          if (!url) {
            setDone(d => d + 1)
            continue
          }
          const content = await fetchPageText(url)
          const summary = summarizeFromHtmlOrText(content)
          await setTextFieldValue(table, textFieldId, recordId, summary)
          setDone(d => d + 1)
        } catch {
          setErrors(e => e + 1)
          setDone(d => d + 1)
        }
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ margin: 10 }}>
      <Typography.Title level={4}>页面抓取</Typography.Title>
      <Alert style={{ marginBottom: 10 }} showIcon type={error ? 'error' : 'info'} message={error || '提示：超链接字段为输入，文本字段为输出；选择后点击“抓取”'} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ marginBottom: 6 }}>输入：超链接字段</div>
          <Select style={{ width: '100%' }} loading={loading} options={linkOptions} onSelect={setLinkFieldId} value={linkFieldId} />
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>输出：文本字段</div>
          <Select style={{ width: '100%' }} loading={loading} options={textOptions} onSelect={setTextFieldId} value={textFieldId} />
        </div>
        <Button type="primary" block onClick={grab} disabled={disabled} loading={running}>抓取</Button>
      </div>
      <div style={{ marginTop: 8 }}>进度：{done}/{total}，错误：{errors}</div>
    </div>
  )
}
