import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { documentedFiles } from './documented-fixtures.mjs';

// 使用不同语法结构，检查真实解析器；这些源文件不作为可执行程序运行。
export const languages = [
  { id: 'javascript', ext: 'js', language: 'JavaScript', fn: 'calculateJsTotal', variable: 'jsTaxRate', source: 'export const jsTaxRate = 0.09;\nexport function calculateJsTotal(price) {\n  const subtotal = price * (1 + jsTaxRate);\n  return subtotal;\n}\n', call: 'calculateJsTotal(100);\n' },
  { id: 'typescript', ext: 'ts', language: 'TypeScript', fn: 'calculateTsTotal', variable: 'tsTaxRate', source: 'export interface Invoice { amount: number }\nexport const tsTaxRate: number = 0.09;\nexport function calculateTsTotal(invoice: Invoice): number {\n  return invoice.amount * (1 + tsTaxRate);\n}\n', call: 'calculateTsTotal({amount: 100});\n' },
  { id: 'python', ext: 'py', language: 'Python', fn: 'calculate_py_total', variable: 'py_tax_rate', source: 'py_tax_rate = 0.09\n\ndef calculate_py_total(price: float) -> float:\n    subtotal = price * (1 + py_tax_rate)\n    return subtotal\n', call: 'calculate_py_total(100)\n' },
  { id: 'go', ext: 'go', language: 'Go', fn: 'CalculateGoTotal', variable: 'GoTaxRate', source: 'package billing\n\nvar GoTaxRate = 0.09\nfunc CalculateGoTotal(price float64) float64 {\n    subtotal := price * (1 + GoTaxRate)\n    return subtotal\n}\n', call: 'package billing\nfunc run() { CalculateGoTotal(100) }\n' },
  { id: 'rust', ext: 'rs', language: 'Rust', fn: 'calculate_rs_total', variable: 'RS_TAX_RATE', source: 'pub const RS_TAX_RATE: f64 = 0.09;\npub fn calculate_rs_total(price: f64) -> f64 {\n    let subtotal = price * (1.0 + RS_TAX_RATE);\n    subtotal\n}\n', call: 'fn main() { calculate_rs_total(100.0); }\n' },
  { id: 'c', ext: 'c', language: 'C', fn: 'calculate_c_total', variable: 'c_tax_rate', source: 'double c_tax_rate = 0.09;\ndouble calculate_c_total(double price) {\n    double subtotal = price * (1 + c_tax_rate);\n    return subtotal;\n}\n', call: 'int main(void) { calculate_c_total(100); }\n' },
  { id: 'cpp', ext: 'cpp', language: 'C++', fn: 'calculateCppTotal', variable: 'cppTaxRate', source: 'namespace billing {\nconstexpr double cppTaxRate = 0.09;\ntemplate<typename T> T calculateCppTotal(T price) {\n    return price * (1 + cppTaxRate);\n}\n}\n', call: 'int main() { billing::calculateCppTotal(100.0); }\n' },
  { id: 'java', ext: 'java', language: 'Java', fn: 'calculateJavaTotal', variable: 'javaTaxRate', source: 'public class Billing {\n    public static double javaTaxRate = 0.09;\n    public static double calculateJavaTotal(double price) {\n        return price * (1 + javaTaxRate);\n    }\n}\n', call: 'class Main { void run() { Billing.calculateJavaTotal(100); } }\n' },
  { id: 'csharp', ext: 'cs', language: 'C#', fn: 'CalculateCsTotal', variable: 'CsTaxRate', source: 'namespace Billing {\npublic class Invoice {\n    public static double CsTaxRate = 0.09;\n    public double CalculateCsTotal(double price) {\n        return price * (1 + CsTaxRate);\n    }\n}\n}\n', call: 'class Main { void Run() { invoice.CalculateCsTotal(100); } }\n' },
  { id: 'php', ext: 'php', language: 'PHP', fn: 'calculate_php_total', variable: 'php_tax_rate', source: '<?php\n$php_tax_rate = 0.09;\nfunction calculate_php_total(float $price): float {\n    return $price * 1.09;\n}\n', call: '<?php\ncalculate_php_total(100);\n' },
  { id: 'ruby', ext: 'rb', language: 'Ruby', fn: 'calculate_rb_total', variable: 'RB_TAX_RATE', source: 'RB_TAX_RATE = 0.09\ndef calculate_rb_total(price)\n  subtotal = price * (1 + RB_TAX_RATE)\n  subtotal\nend\n', call: 'calculate_rb_total(100)\n' },
  { id: 'kotlin', ext: 'kt', language: 'Kotlin', fn: 'calculateKtTotal', variable: 'ktTaxRate', source: 'package billing\nval ktTaxRate: Double = 0.09\nfun calculateKtTotal(price: Double): Double {\n    return price * (1 + ktTaxRate)\n}\n', call: 'fun main() { calculateKtTotal(100.0) }\n' },
  { id: 'swift', ext: 'swift', language: 'Swift', fn: 'calculateSwiftTotal', variable: 'swiftTaxRate', source: 'let swiftTaxRate = 0.09\nfunc calculateSwiftTotal(_ price: Double) -> Double {\n    return price * (1 + swiftTaxRate)\n}\n', call: 'calculateSwiftTotal(100)\n' },
  { id: 'shell', ext: 'sh', language: 'Sh', fn: 'calculate_sh_total', variable: 'sh_tax_rate', source: '#!/bin/sh\nsh_tax_rate=9\ncalculate_sh_total() {\n  subtotal=$(( $1 * (100 + sh_tax_rate) / 100 ))\n  printf "%s\\n" "$subtotal"\n}\n', call: 'calculate_sh_total 100\n' },
];

export function fixtureFiles() {
  const files = new Map();
  for (const item of languages) {
    files.set(`${item.id}/billing.${item.ext}`, item.source);
    files.set(`${item.id}/main.${item.ext}`, item.call);
  }
  const extra = {
    'edges/first.js': 'export function duplicateName() { return 1; }\n',
    'edges/second.js': 'export function duplicateName() { return 2; }\n',
    'edges/main.js': 'duplicateName();\n',
    'edges/buffer.js': 'export function originalFunction() { return 1; }\noriginalFunction();\n',
    'edges/external.js': 'export function externalOriginal() { return 1; }\n',
    'edges/query.js': 'externalOriginal();\n',
    'edges/emoji.js': 'const icon = "😀"; function emojiFunction() { return 1; }\nconst label = "😀"; emojiFunction();\n',
    'edges/unicode.js': 'export function 计算合计(金额) { return 金额; }\n计算合计(100);\n',
    '中文 目录/带 空格.py': 'def unicode_path_total(price):\n    return price\n\nunicode_path_total(100)\n',
    'edges/empty.py': '',
    'edges/incomplete.py': 'def partial_total(value):\n    if value > 0:\n        return value\n\npartial_total(\n',
    'edges/mixed.ts': 'export function crossExtensionTotal() { return 1; }\n',
    'edges/mixed.tsx': 'crossExtensionTotal();\n',
    'data/config.json': '{"service":{"port":8080,"name":"sample"}}\n',
    'data/schema.sql': 'CREATE TABLE invoices (id INTEGER PRIMARY KEY, amount DECIMAL);\n',
    'data/index.html': '<!doctype html>\n<html><body><section id="billing">Billing</section></body></html>\n',
    'data/style.css': '.invoice-card { color: #333; }\n',
  };
  for (const [file, text] of Object.entries(extra)) files.set(file, text);
  for (const [file, text] of Object.entries(documentedFiles)) files.set(file, text);
  return files;
}

export async function createFixtures(root) {
  const files = fixtureFiles();
  for (const [file, text] of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  return files;
}
