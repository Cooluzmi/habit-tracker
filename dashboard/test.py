import sys, os
sys.path.insert(0, os.path.dirname(__file__))
os.chdir(os.path.join(os.path.dirname(__file__), '..'))

# Import test
try:
    exec(open('dashboard/server.py').read().split("if __name__")[0])
    print("SYNTAX: OK")
    print(f"Accounts: {len(accounts)}")
    for a in accounts:
        print(f"  #{a['id']}: {a['user']}/{a['repo']}")
    
    print("\nFetching status...")
    s = fetch_status()
    print(f"Status: OK")
    print(f"Grand: {s['grand']}")
    print(f"Live: {s['live']}")
    print(f"Accounts in result: {len(s['accounts'])}")
    
    print("\nAll checks PASSED")
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()