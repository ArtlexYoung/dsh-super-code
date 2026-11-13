export const documentedFiles = {
  'documentation/pricing.ts': `/**
 * 计算商品的含税金额。
 *
 * 价格和税率均使用十进制数值。
 * @param price - 商品原价，必须大于或等于零。
 * @param taxRate - 税率，默认值为 0.09。
 * @returns 含税金额，保留原始精度。
 * @example calculateTotal(100, 0.09)
 */
export function calculateTotal(
  price: number,
  taxRate: number = 0.09,
): number {
  return price * (1 + taxRate);
}

export function discountedTotal(price: number, discount: number): number {
  return calculateTotal(price) * (1 - discount);
}
`,
  'documentation/checkout.ts': `import { calculateTotal } from './pricing';

const subtotal: number = 100;
const total: number = calculateTotal(subtotal, 0.09);

function formatInvoice(): string {
  return String(calculateTotal(200));
}

// calculateTotal(999) 只在注释里，不算用法。
const helpText = "calculateTotal(999) 只是字符串";
const templateText = \`calculateTotal 文本，真实插值：\${calculateTotal(50)}\`;
`,
  'documentation/invoice.py': `def calculate_invoice_total(price: float, tax_rate: float = 0.09) -> float:
    """计算发票含税金额。

    Args:
        price (float): 商品原价。
        tax_rate (float): 税率，默认为 0.09。

    Returns:
        float: 含税金额。
    """
    return price * (1 + tax_rate)

total = calculate_invoice_total(100)
`,
  'documentation/Billing.java': `public class Billing {
    /**
     * 计算含税金额。
     * @param price 商品原价。
     * @param taxRate 税率。
     * @return 含税金额。
     */
    public static double calculateDocumentedTotal(double price, double taxRate) {
        return price * (1 + taxRate);
    }
}
`,
  'documentation/Billing.cs': `public class Billing {
    /// <summary>计算含税金额。</summary>
    /// <param name="price">商品原价。</param>
    /// <param name="taxRate">税率。</param>
    /// <returns>含税金额。</returns>
    public static double CalculateDocumentedTotal(double price, double taxRate) {
        return price * (1 + taxRate);
    }
}
`,
  'documentation/pricing.go': `package billing

// CalculateDocumentedTotal computes the tax-inclusive price.
// price is the original price; taxRate is a decimal tax rate.
func CalculateDocumentedTotal(price float64, taxRate float64) float64 {
    return price * (1 + taxRate)
}
`,
  'documentation/pricing.rs': `/// 计算含税金额。
///
/// # Arguments
/// * \`price\` - 商品原价。
/// * \`tax_rate\` - 税率。
pub fn calculate_documented_total(price: f64, tax_rate: f64) -> f64 {
    price * (1.0 + tax_rate)
}
`,
};
