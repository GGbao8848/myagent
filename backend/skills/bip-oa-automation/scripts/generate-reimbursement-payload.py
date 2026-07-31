#!/usr/bin/env python3
"""
Generate BIP reimbursement XML payload from extracted invoice data.
Output: a Python script that can be run on the internal network to submit.

Usage:
  python generate-reimbursement-payload.py --input extracted_data.json --output submit_reimbursement.py

⚠️ IMPORTANT:
  - Login via /login.do with UserID/UserPwd (NOT UsrID/Password)
  - Password must be AES-CBC encrypted (Key='Test-AES-CBC-128', IV='1234567890123456')
  - oprperform.do has NO same-origin check — Python requests work directly
  - All top-level params must NOT contain Chinese; Chinese only in XML attributes
  - Use urllib.parse.urlencode then .encode('utf-8'), NOT GBK
  - XML declaration must use encoding="UTF-8", NOT encoding="GBK"
  - The generated script template MUST NOT hardcode passwords — use a placeholder
  - FileUrl double quotes must be escaped as &quot; in XML attributes

Input JSON format (extracted_data.json):
{
  "travel_application": {
    "srcDocNo": "CXS26050555",
    "srcDocType": "BTA",
    "PayoutAmt": "2000",
    "BeginDate": "2026-05-29 15:00:02",
    "EndDate": "2026-06-02 23:59:24",
    "BTDestination": "上海浦东",
    "BTReason": "洋山中集项目实施",
    "BTType": "1",
    "CustomerName": "中集洋山",
    "ProjectID": "BRS25905"
  },
  "employee": {
    "id": "BRS1862",
    "name": "龙占全",
    "company": "BRS1",
    "org": "JT117",
    "bank_doc_no": "1633661740986580994",
    "bank_info": "龙占全-6217732005062124-中信银行-中信银行股份有限公司苏州金鸡湖支行"
  },
  "expenses": [
    {
      "fee_id": "ADT01",
      "fee_desc": "ADT,ADT01",
      "rmrk": "出差上海住宿",
      "begin_date": "2026-05-29",
      "end_date": "2026-05-30",
      "fee_amt": "190.01",
      "fee_amt_bc": "190.01",
      "invc_no": "FAP-20260610-0049",
      "destination": "中国,上海市,市辖区,浦东新区",
      "addr_id": "310115",
      "file_urls": [{"FileName": "发票.png", "FileUrl": "/doc/2026/06/10/xxx/发票.png"}]
    }
  ]
}
"""

import json
import sys
import argparse
from xml.sax.saxutils import escape


def build_xmldetail(attrs: dict) -> str:
    """Build a single <xmldetail key1="val1" key2="val2"/> element."""
    parts = []
    for k, v in attrs.items():
        if v is not None and v != '':
            parts.append(f'{k}="{escape(str(v))}"')
    return f'<xmldetail {" ".join(parts)}/>'


def build_xml(rows: list) -> str:
    """Build <ROOT><xmldetail .../>...</ROOT> from a list of dicts."""
    details = '\n'.join(build_xmldetail(r) for r in rows)
    return f'<?xml version="1.0" encoding="UTF-8"?><ROOT>{details}</ROOT>'


def build_form_xml(obj: dict) -> str:
    """Build single-row XML from a flat dict (form-style)."""
    return f'<?xml version="1.0" encoding="UTF-8"?><ROOT>{build_xmldetail(obj)}</ROOT>'


def make_file_url_xml_attr(file_urls: list) -> str:
    """Convert file_urls list to XML-safe JSON string with &quot; escaping."""
    items = []
    for fu in file_urls:
        items.append(f'{{"FileName":"{fu["FileName"]}","FileUrl":"{fu["FileUrl"]}"}}')
    json_str = '[' + ','.join(items) + ']'
    return json_str.replace('"', '&quot;')


def generate_submit_script(data: dict) -> str:
    """Generate a self-contained Python submit script."""
    emp = data['employee']
    ta = data.get('travel_application', {})
    expenses = data['expenses']

    # Calculate totals
    total_amt = sum(float(e['fee_amt']) for e in expenses)
    total_amt_str = f'{total_amt:.2f}'

    # Build form (all fields merged into xmldetails0)
    form = {
        'CreateUsr': emp['id'],
        'RefEmp': emp['id'],
        'CreateDate': data.get('doc_date', ''),
        'PostDate': data.get('doc_date', ''),
        'ExpenseDate': data.get('doc_date', ''),
        'CompanyID': emp['company'],
        'APType': '0',
        'BankDocNo': emp.get('bank_doc_no', ''),
        'BankInfo': emp.get('bank_info', ''),
        'RefEmpOrg': emp.get('org', ''),
        'APAmt': total_amt_str,
        'APAmtBC': total_amt_str,
        'Curr': 'CNY',
        'APName': f'{emp["name"]}申请的出差申请单',
        'RealAPAmt': total_amt_str,
        'RealAPAmtBC': total_amt_str,
    }

    # Add travel application fields
    if ta.get('PayoutAmt'):
        form['PayoutAmt'] = ta['PayoutAmt']
        form['PayoutAmtBC'] = ta['PayoutAmt']
    if ta.get('srcDocNo'):
        form['srcDocType'] = ta.get('srcDocType', 'BTA')
        form['srcDocNo'] = ta['srcDocNo']
    if ta.get('BeginDate'):
        form['BeginDate'] = ta['BeginDate']
        form['EndDate'] = ta.get('EndDate', '')
    if ta.get('BTDestination'):
        form['BTDestination'] = ta['BTDestination']
    if ta.get('BTReason'):
        form['BTReason'] = ta['BTReason']
    if ta.get('BTType'):
        form['BTType'] = ta['BTType']
    if ta.get('CustomerName'):
        form['CustomerName'] = ta['CustomerName']
    if ta.get('ProjectID'):
        form['ProjectID'] = ta['ProjectID']

    # Build expense details
    expense_rows = []
    for exp in expenses:
        row = {
            'FeeID': exp['fee_id'],
            'FeeDesc': exp.get('fee_desc', exp['fee_id']),
            'FeeAmt': exp['fee_amt'],
            'FeeAmtBC': exp['fee_amt_bc'],
            'Curr': 'CNY',
            'Rmrk': exp['rmrk'],
            'ProjectID': ta.get('ProjectID', ''),
        }
        if exp.get('begin_date'):
            row['Date'] = f'{exp["begin_date"]},{exp.get("end_date", exp["begin_date"])}'
            row['RefDocBeginDate'] = exp['begin_date']
            row['RefDocEndDate'] = exp.get('end_date', exp['begin_date'])
        if exp.get('invc_no'):
            row['InvcNo'] = exp['invc_no']
        if exp.get('start_point'):
            row['StartPoint'] = exp['start_point']
        if exp.get('destination'):
            row['Destination'] = exp['destination']
        if exp.get('addr_id'):
            row['AddrId'] = exp['addr_id']
        if exp.get('file_urls'):
            row['FileUrl'] = make_file_url_xml_attr(exp['file_urls'])
        if exp.get('driving_record_no'):
            row['DrivingRecordNo'] = exp['driving_record_no']
        if exp.get('actual_mileage'):
            row['ActualMileage'] = exp['actual_mileage']
        expense_rows.append(row)

    # Build the script
    xmldetails0 = build_form_xml(form)
    xmldetails1 = build_xml(expense_rows)

    script = '''#!/usr/bin/env python3
"""Auto-generated BIP reimbursement submit script."""
import requests
import urllib.parse

BASE_URL = "http://10.10.10.247/powerbip"

def login():
    session = requests.Session()
    resp = session.post(f"{BASE_URL}/login.do", data={{
        "UserID": "%s",
        "UserPwd": "<AES-CBC-ENCRYPTED-PASSWORD>",  # REPLACE with actual encrypted password
        "_ENCODE_": "UTF-8"
    }})
    data = resp.json()
    if str(data.get("Ret")) != "1":
        raise RuntimeError(f"登录失败: {{data}}")
    print("Login OK:", session.cookies.get("username"))
    return session

def main():
    session = login()

    xmldetails0 = %s
    xmldetails1 = %s
    xmldetails2 = '<?xml version="1.0" encoding="UTF-8" ?><ROOT></ROOT>'

    params = {
        "trancode": "OA600000",
        "mode": "1",
        "DocType": "CXB",
        "CompanyID": "%s",
        "execmode": "Audit",
        "srccopied": "apply",
        "xmldetails0": xmldetails0,
        "xmldetails1": xmldetails1,
        "xmldetails2": xmldetails2,
        "_ENCODE_": "UTF-8"
    }

    # Encode: all top-level params must NOT contain Chinese
    body = urllib.parse.urlencode(params)
    resp = session.post(f"{BASE_URL}/oprperform.do",
        data=body.encode("utf-8"),
        headers={{"Content-Type": "application/x-www-form-urlencoded"}})

    data = resp.json()
    print("Result:", json.dumps(data, ensure_ascii=False, indent=2))

    if str(data.get("Ret")) != "1":
        print("\\nFAILED (Ret!=1):", data.get("Msg", "Unknown error"))
        sys.exit(1)

    if data.get("Code") == "FORWARD":
        print("\\nSUCCESS: Reimbursement submitted for approval!")
    else:
        print("\\nFAILED:", data.get("Msg", "Unknown error"))

if __name__ == "__main__":
    main()
''' % (emp['id'], json.dumps(xmldetails0, ensure_ascii=False),
       json.dumps(xmldetails1, ensure_ascii=False), emp['company'])
    return script


def main():
    parser = argparse.ArgumentParser(description="Generate BIP reimbursement submit script")
    parser.add_argument("--input", required=True, help="Input JSON file with extracted invoice data")
    parser.add_argument("--output", default="submit_reimbursement.py", help="Output Python script path")
    args = parser.parse_args()

    with open(args.input, 'r', encoding='utf-8') as f:
        data = json.load(f)

    script = generate_submit_script(data)

    with open(args.output, 'w', encoding='utf-8') as f:
        f.write(script)

    print(f"Submit script generated: {args.output}")
    print(f"Run it on the internal network: python {args.output}")


if __name__ == "__main__":
    main()
