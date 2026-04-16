import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

class XorShift32 {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    let x = this.state
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.state = x >>> 0
    return this.state / 0x100000000
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min)
  }
}

type WeightedOption<T> = {
  value: T
  weight: number
}

const rng = new XorShift32(42)
const outputDir = new URL('../public/sample-data/', import.meta.url)

const countryOptions: WeightedOption<string>[] = [
  { value: 'US', weight: 28 },
  { value: 'GB', weight: 12 },
  { value: 'DE', weight: 10 },
  { value: 'FR', weight: 9 },
  { value: 'IT', weight: 8 },
  { value: 'ES', weight: 7 },
  { value: 'CA', weight: 9 },
  { value: 'AU', weight: 7 },
  { value: 'NL', weight: 5 },
  { value: 'JP', weight: 5 },
]

const ecommerceCategoryOptions: WeightedOption<string>[] = [
  { value: 'Electronics', weight: 27 },
  { value: 'Clothing', weight: 24 },
  { value: 'Home', weight: 20 },
  { value: 'Books', weight: 14 },
  { value: 'Sports', weight: 15 },
]

const shippingStatusOptions: WeightedOption<string>[] = [
  { value: 'delivered', weight: 72 },
  { value: 'shipped', weight: 15 },
  { value: 'processing', weight: 9 },
  { value: 'returned', weight: 4 },
]

const paymentStatusOptions: WeightedOption<string>[] = [
  { value: 'succeeded', weight: 85 },
  { value: 'failed', weight: 10 },
  { value: 'pending', weight: 5 },
]

const currencyOptions: WeightedOption<string>[] = [
  { value: 'USD', weight: 50 },
  { value: 'EUR', weight: 35 },
  { value: 'GBP', weight: 15 },
]

const planOptions: WeightedOption<string>[] = [
  { value: 'starter', weight: 52 },
  { value: 'pro', weight: 36 },
  { value: 'enterprise', weight: 12 },
]

const pagePathOptions: WeightedOption<string>[] = [
  { value: '/', weight: 35 },
  { value: '/pricing', weight: 18 },
  { value: '/docs', weight: 22 },
  { value: '/blog', weight: 17 },
  { value: '/contact', weight: 8 },
]

const referrerOptions: WeightedOption<string>[] = [
  { value: 'google', weight: 40 },
  { value: 'twitter', weight: 12 },
  { value: 'direct', weight: 26 },
  { value: 'linkedin', weight: 10 },
  { value: 'reddit', weight: 12 },
]

const deviceTypeOptions: WeightedOption<string>[] = [
  { value: 'desktop', weight: 48 },
  { value: 'mobile', weight: 43 },
  { value: 'tablet', weight: 9 },
]

function pickWeighted<T>(options: WeightedOption<T>[]): T {
  const totalWeight = options.reduce((sum, option) => sum + option.weight, 0)
  let threshold = rng.next() * totalWeight

  for (const option of options) {
    threshold -= option.weight
    if (threshold <= 0) {
      return option.value
    }
  }

  return options[options.length - 1].value
}

function randomDate(start: Date, end: Date): string {
  const timestamp = start.getTime() + rng.next() * (end.getTime() - start.getTime())
  return new Date(timestamp).toISOString()
}

function formatMoney(amount: number): string {
  return amount.toFixed(2)
}

function csvEscape(value: string | number | boolean): string {
  const text = String(value)
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }

  return text
}

function toCsv(headers: string[], rows: Array<Record<string, string | number | boolean>>): string {
  const lines = [headers.join(',')]

  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? '')).join(','))
  }

  return `${lines.join('\n')}\n`
}

function hashSeededEmail(index: number): string {
  const email = `customer${index}@seeded-example.com`
  return createHash('sha256').update(email).digest('hex')
}

function buildEcommerceOrders() {
  const headers = [
    'order_id',
    'customer_id',
    'order_date',
    'country',
    'product_category',
    'quantity',
    'unit_price',
    'discount_pct',
    'total_amount',
    'shipping_status',
  ]

  const start = new Date('2024-01-01T00:00:00.000Z')
  const end = new Date('2024-12-31T23:59:59.999Z')
  const rows = Array.from({ length: 1500 }, (_, index) => {
    const quantity = rng.int(1, 10)
    const unitPrice = Number(formatMoney(rng.float(10, 500)))
    const discountPct = rng.int(0, 30)
    const totalAmount = Number(formatMoney(quantity * unitPrice * (1 - discountPct / 100)))

    return {
      order_id: `ord_${String(index + 1).padStart(6, '0')}`,
      customer_id: `cust_${String(rng.int(1, 450)).padStart(5, '0')}`,
      order_date: randomDate(start, end),
      country: pickWeighted(countryOptions),
      product_category: pickWeighted(ecommerceCategoryOptions),
      quantity,
      unit_price: formatMoney(unitPrice),
      discount_pct: discountPct,
      total_amount: formatMoney(totalAmount),
      shipping_status: pickWeighted(shippingStatusOptions),
    }
  })

  return { headers, rows }
}

function buildStripePayments() {
  const headers = [
    'payment_id',
    'created_at',
    'amount_cents',
    'currency',
    'status',
    'customer_email_hash',
    'card_country',
    'plan_name',
  ]

  const start = new Date('2024-07-01T00:00:00.000Z')
  const end = new Date('2024-12-31T23:59:59.999Z')
  const rows = Array.from({ length: 1000 }, (_, index) => ({
    payment_id: `pay_${String(index + 1).padStart(6, '0')}`,
    created_at: randomDate(start, end),
    amount_cents: rng.int(500, 50000),
    currency: pickWeighted(currencyOptions),
    status: pickWeighted(paymentStatusOptions),
    customer_email_hash: hashSeededEmail(rng.int(1, 650)),
    card_country: pickWeighted(countryOptions),
    plan_name: pickWeighted(planOptions),
  }))

  return { headers, rows }
}

function buildWebAnalytics() {
  const headers = [
    'session_id',
    'timestamp',
    'user_id',
    'page_path',
    'referrer',
    'device_type',
    'session_duration_sec',
    'events_count',
    'converted',
  ]

  const start = new Date('2024-12-02T00:00:00.000Z')
  const end = new Date('2024-12-31T23:59:59.999Z')
  const rows = Array.from({ length: 2000 }, (_, index) => ({
    session_id: `sess_${String(index + 1).padStart(7, '0')}`,
    timestamp: randomDate(start, end),
    user_id: `user_${String(rng.int(1, 900)).padStart(5, '0')}`,
    page_path: pickWeighted(pagePathOptions),
    referrer: pickWeighted(referrerOptions),
    device_type: pickWeighted(deviceTypeOptions),
    session_duration_sec: rng.int(10, 3600),
    events_count: rng.int(1, 50),
    converted: rng.next() < 0.08,
  }))

  return { headers, rows }
}

async function main() {
  await mkdir(outputDir, { recursive: true })

  const files = [
    ['ecommerce-orders.csv', buildEcommerceOrders()],
    ['stripe-payments.csv', buildStripePayments()],
    ['web-analytics.csv', buildWebAnalytics()],
  ] as const

  await Promise.all(
    files.map(([fileName, dataset]) =>
      writeFile(new URL(fileName, outputDir), toCsv(dataset.headers, dataset.rows), 'utf8'),
    ),
  )
}

await main()
