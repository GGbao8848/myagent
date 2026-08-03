import sys, re
expr = sys.argv[1] if len(sys.argv) > 1 else ''
if not re.fullmatch(r'[\d+\-*/().\s]+', expr):
    print('ERROR: invalid expression')
    sys.exit(1)
print(eval(expr))
