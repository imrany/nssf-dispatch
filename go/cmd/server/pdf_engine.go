package main

import (
	"bytes"
	"compress/zlib"
	"crypto/md5"
	"crypto/rand"
	"crypto/rc4"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type StatementMeta struct {
	MemberNo        string `json:"memberNo"`
	MemberName      string `json:"memberName"`
	IDCardNo        string `json:"idCardNo"`
	DateOfBirth     string `json:"dateOfBirth"`
	DateRegistered  string `json:"dateRegistered"`
	KRAPin          string `json:"kraPin"`
	Employer        string `json:"employer"`
	Period          string `json:"period"`
	StatementDate   string `json:"statementDate"`
	StandardAmount  string `json:"standardAmount"`
	VoluntaryAmount string `json:"voluntaryAmount"`
	TotalAmount     string `json:"totalAmount"`
}

type pdfToken struct {
	x    float64
	y    float64
	text string
}

var pdfPadding = []byte{
	0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41,
	0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
	0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80,
	0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A,
}

func decodeASCII85(input string) []byte {
	s := strings.TrimSpace(input)
	s = strings.TrimPrefix(s, "<~")
	if idx := strings.Index(s, "~>"); idx != -1 {
		s = s[:idx]
	}

	var out []byte
	var tuple uint32
	count := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c <= 32 {
			continue
		}
		if c == 'z' && count == 0 {
			out = append(out, 0, 0, 0, 0)
			continue
		}
		if c < 33 || c > 117 {
			continue
		}
		tuple = tuple*85 + uint32(c-33)
		count++
		if count == 5 {
			out = append(out, byte(tuple>>24), byte(tuple>>16), byte(tuple>>8), byte(tuple))
			tuple = 0
			count = 0
		}
	}
	if count > 1 {
		for i := count; i < 5; i++ {
			tuple = tuple*85 + 84
		}
		for i := 0; i < count-1; i++ {
			out = append(out, byte(tuple>>(24-uint(i)*8)))
		}
	}
	return out
}

func unescapePDFLiteral(raw string) []byte {
	var out []byte
	for i := 0; i < len(raw); i++ {
		if raw[i] == '\\' && i+1 < len(raw) {
			next := raw[i+1]
			switch next {
			case 'n':
				out = append(out, '\n')
				i++
			case 'r':
				out = append(out, '\r')
				i++
			case 't':
				out = append(out, '\t')
				i++
			case 'b':
				out = append(out, '\b')
				i++
			case 'f':
				out = append(out, '\f')
				i++
			case '(', ')', '\\':
				out = append(out, next)
				i++
			default:
				if next >= '0' && next <= '7' {
					end := i + 2
					for end < len(raw) && end < i+4 && raw[end] >= '0' && raw[end] <= '7' {
						end++
					}
					val, _ := strconv.ParseInt(raw[i+1:end], 8, 16)
					out = append(out, byte(val))
					i = end - 1
				} else {
					out = append(out, next)
					i++
				}
			}
		} else {
			out = append(out, raw[i])
		}
	}
	return out
}

func reconstructContentStreamRows(streamText string) []string {
	var tokens []pdfToken
	inBT := false
	tx, ty, tlmX, tlmY := 0.0, 0.0, 0.0, 0.0
	leading := 14.0
	var numStack []float64
	n := len(streamText)
	i := 0

	readLiteral := func() string {
		depth := 1
		var sb strings.Builder
		i++
		for i < n && depth > 0 {
			ch := streamText[i]
			if ch == '\\' && i+1 < n {
				sb.WriteByte(ch)
				sb.WriteByte(streamText[i+1])
				i += 2
				continue
			}
			if ch == '(' {
				depth++
			} else if ch == ')' {
				depth--
				if depth == 0 {
					i++
					break
				}
			}
			sb.WriteByte(ch)
			i++
		}
		return string(unescapePDFLiteral(sb.String()))
	}

	for i < n {
		ch := streamText[i]
		if ch <= ' ' {
			i++
			continue
		}
		if ch == '(' {
			lit := strings.TrimSpace(readLiteral())
			for i < n && streamText[i] <= ' ' {
				i++
			}
			if i+2 <= n && streamText[i:i+2] == "Tj" {
				if lit != "" {
					tokens = append(tokens, pdfToken{x: tx, y: ty, text: lit})
				}
				i += 2
			} else if i < n && (streamText[i] == '\'' || streamText[i] == '"') {
				tlmY -= leading
				tx, ty = tlmX, tlmY
				if lit != "" {
					tokens = append(tokens, pdfToken{x: tx, y: ty, text: lit})
				}
				i++
			}
			continue
		}
		if ch == '[' {
			i++
			var combined strings.Builder
			for i < n && streamText[i] != ']' {
				if streamText[i] == '(' {
					combined.WriteString(readLiteral())
				} else {
					i++
				}
			}
			if i < n && streamText[i] == ']' {
				i++
			}
			for i < n && streamText[i] <= ' ' {
				i++
			}
			if i+2 <= n && streamText[i:i+2] == "TJ" {
				txt := strings.TrimSpace(combined.String())
				if txt != "" {
					tokens = append(tokens, pdfToken{x: tx, y: ty, text: txt})
				}
				i += 2
			}
			continue
		}
		if ch == '/' {
			i++
			for i < n && streamText[i] > ' ' && !strings.ContainsRune("()[]<>{}/%", rune(streamText[i])) {
				i++
			}
			continue
		}
		if (ch >= '0' && ch <= '9') || ch == '-' || ch == '+' || ch == '.' {
			start := i
			for i < n && ((streamText[i] >= '0' && streamText[i] <= '9') || streamText[i] == '.' || streamText[i] == '-' || streamText[i] == '+') {
				i++
			}
			if v, err := strconv.ParseFloat(streamText[start:i], 64); err == nil {
				numStack = append(numStack, v)
			}
			continue
		}
		if (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch == '*' {
			start := i
			for i < n && ((streamText[i] >= 'A' && streamText[i] <= 'Z') || (streamText[i] >= 'a' && streamText[i] <= 'z') || streamText[i] == '*') {
				i++
			}
			op := streamText[start:i]
			switch op {
			case "BT":
				inBT = true
				tx, ty, tlmX, tlmY = 0, 0, 0, 0
			case "ET":
				inBT = false
			case "Td", "TD":
				if inBT && len(numStack) >= 2 {
					dy := numStack[len(numStack)-1]
					dx := numStack[len(numStack)-2]
					tlmX += dx
					tlmY += dy
					tx, ty = tlmX, tlmY
					if op == "TD" {
						leading = -dy
					}
				}
			case "Tm":
				if inBT && len(numStack) >= 6 {
					tlmX = numStack[len(numStack)-2]
					tlmY = numStack[len(numStack)-1]
					tx, ty = tlmX, tlmY
				}
			case "TL":
				if inBT && len(numStack) >= 1 {
					leading = numStack[len(numStack)-1]
				}
			case "T*":
				if inBT {
					tlmY -= leading
					tx, ty = tlmX, tlmY
				}
			}
			numStack = numStack[:0]
			continue
		}
		i++
	}

	if len(tokens) == 0 {
		return nil
	}

	sort.Slice(tokens, func(a, b int) bool {
		if tokens[a].y != tokens[b].y {
			return tokens[a].y > tokens[b].y
		}
		return tokens[a].x < tokens[b].x
	})

	var rows [][]pdfToken
	for _, t := range tokens {
		if len(rows) > 0 && math.Abs(rows[len(rows)-1][0].y-t.y) <= 2.2 {
			rows[len(rows)-1] = append(rows[len(rows)-1], t)
		} else {
			rows = append(rows, []pdfToken{t})
		}
	}

	out := make([]string, 0, len(rows))
	for _, r := range rows {
		sort.Slice(r, func(a, b int) bool { return r[a].x < r[b].x })
		parts := make([]string, len(r))
		for idx, tok := range r {
			parts[idx] = tok.text
		}
		out = append(out, strings.Join(parts, " "))
	}
	return out
}

func ExtractAndValidatePDF(pdfBytes []byte, expectedMemberNo string) (*StatementMeta, error) {
	if len(pdfBytes) < 8 || !strings.Contains(string(pdfBytes[:8]), "%PDF-") {
		return nil, errors.New("the uploaded file is not a valid PDF document")
	}

	streamRe := regexp.MustCompile(`(?s)(<<.*?>>)\s*stream\r?\n(.*?)\r?\n?endstream`)
	matches := streamRe.FindAllStringSubmatch(string(pdfBytes), -1)

	var allRows []string
	for _, m := range matches {
		dict := m[1]
		data := []byte(m[2])
		if strings.Contains(dict, "/ASCII85Decode") {
			data = decodeASCII85(m[2])
		}
		if strings.Contains(dict, "/FlateDecode") || !strings.Contains(dict, "/ASCII85Decode") {
			zr, err := zlib.NewReader(bytes.NewReader(data))
			if err == nil {
				inflated, err := io.ReadAll(zr)
				zr.Close()
				if err == nil {
					data = inflated
				}
			}
		}
		rows := reconstructContentStreamRows(string(data))
		allRows = append(allRows, rows...)
	}

	fullText := strings.Join(allRows, "\n")
	memberNo := findField(fullText, `(?i)NSSF Member No:\s*([A-Z0-9]+)`)
	if memberNo == "" {
		return nil, errors.New("could not read NSSF Member Number from uploaded PDF")
	}
	if !strings.EqualFold(strings.TrimSpace(memberNo), strings.TrimSpace(expectedMemberNo)) {
		return nil, fmt.Errorf("validation mismatch: entered NSSF Number (%s) does not match statement (%s)", expectedMemberNo, memberNo)
	}

	idCard := findField(fullText, `(?i)Id Card No:\s*([A-Z0-9]+)`)
	if idCard == "" {
		return nil, errors.New("member ID Card Number missing in statement; cannot password-protect")
	}

	employer := findField(fullText, `(?i)Employer:\s*([A-Z0-9\s&.,'-]+?)(?:\s+Interest \(New Fund\):|\n|$)`)
	for i, row := range allRows {
		if strings.Contains(strings.ToLower(row), "employer:") && i+1 < len(allRows) {
			next := strings.TrimSpace(allRows[i+1])
			if next != "" && len(next) < 40 && !strings.Contains(strings.ToLower(next), "monthly") {
				employer = strings.TrimSpace(employer + " " + next)
			}
			break
		}
	}

	meta := &StatementMeta{
		MemberNo:        memberNo,
		MemberName:      defaultStr(findField(fullText, `(?i)Member Name:\s*([A-Za-z0-9\s.'-]+?)(?:\s+KRA Pin No:|\s+Date of Birth:|\s+Benefit Type|\n|$)`), "NSSF Member"),
		IDCardNo:        idCard,
		DateOfBirth:     findField(fullText, `(?i)Date of Birth:\s*([0-9]{2}[./-][0-9]{2}[./-][0-9]{4})`),
		DateRegistered:  findField(fullText, `(?i)Date Registered:\s*([0-9]{2}[./-][0-9]{2}[./-][0-9]{4})`),
		KRAPin:          findField(fullText, `(?i)KRA Pin No:\s*([AP][0-9]{9}[A-Z])\b`),
		Employer:        employer,
		Period:          defaultStr(findField(fullText, `(?i)Period From\s+([0-9/.-]+\s+until\s+[0-9/.-]+)`), "Current Statement Period"),
		StatementDate:   findField(fullText, `(?i)Date:\s*([0-9]{2}[./-][0-9]{2}[./-][0-9]{4})`),
		StandardAmount:  defaultStr(findField(fullText, `(?i)Standard:\s*([0-9,]+\.[0-9]{2})`), "0.00"),
		VoluntaryAmount: defaultStr(findField(fullText, `(?i)Voluntary:\s*([0-9,]+\.[0-9]{2})`), "0.00"),
		TotalAmount:     defaultStr(findField(fullText, `(?i)Total Amount:\s*([0-9,]+\.[0-9]{2})`), "0.00"),
	}
	return meta, nil
}

func findField(corpus, pattern string) string {
	re := regexp.MustCompile(pattern)
	m := re.FindStringSubmatch(corpus)
	if len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

func defaultStr(val, fallback string) string {
	if strings.TrimSpace(val) == "" {
		return fallback
	}
	return val
}

func padPassword(pwd string) []byte {
	out := make([]byte, 32)
	b := []byte(pwd)
	if len(b) >= 32 {
		copy(out, b[:32])
	} else {
		copy(out, b)
		copy(out[len(b):], pdfPadding[:32-len(b)])
	}
	return out
}

func rc4Encrypt(key, data []byte) []byte {
	out := make([]byte, len(data))
	copy(out, data)
	c, _ := rc4.NewCipher(key)
	c.XORKeyStream(out, out)
	return out
}

func encryptObjectStrings(body string, objKey []byte) string {
	var out strings.Builder
	n := len(body)
	i := 0
	for i < n {
		ch := body[i]
		if ch == '%' {
			nl := strings.IndexByte(body[i:], '\n')
			if nl == -1 {
				out.WriteString(body[i:])
				break
			}
			out.WriteString(body[i : i+nl+1])
			i += nl + 1
			continue
		}
		if ch == '<' && i+1 < n && body[i+1] == '<' {
			out.WriteString("<<")
			i += 2
			continue
		}
		if ch == '>' && i+1 < n && body[i+1] == '>' {
			out.WriteString(">>")
			i += 2
			continue
		}
		if ch == '(' {
			depth := 1
			start := i + 1
			i++
			for i < n && depth > 0 {
				if body[i] == '\\' && i+1 < n {
					i += 2
					continue
				}
				if body[i] == '(' {
					depth++
				} else if body[i] == ')' {
					depth--
					if depth == 0 {
						break
					}
				}
				i++
			}
			plain := unescapePDFLiteral(body[start:i])
			cipher := rc4Encrypt(objKey, plain)
			out.WriteString("<" + strings.ToUpper(hex.EncodeToString(cipher)) + ">")
			if i < n && body[i] == ')' {
				i++
			}
			continue
		}
		if ch == '<' {
			closeIdx := strings.IndexByte(body[i+1:], '>')
			if closeIdx != -1 {
				hexStr := strings.Map(func(r rune) rune {
					if r <= ' ' {
						return -1
					}
					return r
				}, body[i+1:i+1+closeIdx])
				if len(hexStr)%2 == 1 {
					hexStr += "0"
				}
				plain, err := hex.DecodeString(hexStr)
				if err == nil {
					cipher := rc4Encrypt(objKey, plain)
					out.WriteString("<" + strings.ToUpper(hex.EncodeToString(cipher)) + ">")
					i += 2 + closeIdx
					continue
				}
			}
		}
		out.WriteByte(ch)
		i++
	}
	return out.String()
}

func EncryptPDFWithPassword(pdfBytes []byte, userPassword string) ([]byte, error) {
	fileID := make([]byte, 16)
	if _, err := rand.Read(fileID); err != nil {
		return nil, err
	}

	ownerPad := padPassword("NSSF_KENYA_VAULT_2026")
	userPad := padPassword(userPassword)

	h := md5.Sum(ownerPad)
	for i := 0; i < 50; i++ {
		h = md5.Sum(h[:])
	}
	ownerKey := h[:16]
	oVal := make([]byte, 32)
	copy(oVal, userPad)
	for i := 0; i < 20; i++ {
		tmp := make([]byte, 16)
		for j := 0; j < 16; j++ {
			tmp[j] = ownerKey[j] ^ byte(i)
		}
		oVal = rc4Encrypt(tmp, oVal)
	}

	perm := []byte{0xC0, 0xF0, 0xFF, 0xFF}
	hasher := md5.New()
	hasher.Write(userPad)
	hasher.Write(oVal)
	hasher.Write(perm)
	hasher.Write(fileID)
	encKey := hasher.Sum(nil)
	for i := 0; i < 50; i++ {
		sum := md5.Sum(encKey[:16])
		encKey = sum[:16]
	}
	fileEncKey := encKey[:16]

	uHash := md5.New()
	uHash.Write(pdfPadding)
	uHash.Write(fileID)
	uVal := uHash.Sum(nil)
	for i := 0; i < 20; i++ {
		tmp := make([]byte, 16)
		for j := 0; j < 16; j++ {
			tmp[j] = fileEncKey[j] ^ byte(i)
		}
		uVal = rc4Encrypt(tmp, uVal)
	}
	uFull := append(uVal, make([]byte, 16)...)

	latin := string(pdfBytes)
	trailerIdx := strings.LastIndex(latin, "trailer")
	trailerSlice := latin
	if trailerIdx != -1 {
		trailerSlice = latin[trailerIdx:]
	}
	rootRef := defaultStr(findField(trailerSlice, `/Root\s+(\d+\s+\d+\s+R)`), "1 0 R")
	infoRef := findField(trailerSlice, `/Info\s+(\d+\s+\d+\s+R)`)

	objRe := regexp.MustCompile(`(?s)(\d+)\s+(\d+)\s+obj\b(.*?)endobj`)
	matches := objRe.FindAllStringSubmatch(latin, -1)
	if len(matches) == 0 {
		return nil, errors.New("could not parse PDF indirect objects for encryption")
	}

	type pdfObj struct {
		gen     int
		content []byte
	}
	objects := map[int]pdfObj{}
	maxObjNum := 0

	for _, m := range matches {
		objNum, _ := strconv.Atoi(m[1])
		genNum, _ := strconv.Atoi(m[2])
		rawBody := m[3]
		if objNum > maxObjNum {
			maxObjNum = objNum
		}

		objKeyInput := append([]byte{}, fileEncKey...)
		objKeyInput = append(objKeyInput, byte(objNum), byte(objNum>>8), byte(objNum>>16), byte(genNum), byte(genNum>>8))
		objKeySum := md5.Sum(objKeyInput)
		objKey := objKeySum[:16]

		sIdx := strings.Index(rawBody, "stream")
		eIdx := strings.LastIndex(rawBody, "endstream")
		if sIdx != -1 && eIdx > sIdx {
			dictPart := encryptObjectStrings(rawBody[:sIdx], objKey)
			dataStart := sIdx + 6
			if dataStart < len(rawBody) && rawBody[dataStart] == '\r' {
				dataStart++
			}
			if dataStart < len(rawBody) && rawBody[dataStart] == '\n' {
				dataStart++
			}
			dataEnd := eIdx
			if dataEnd > dataStart && rawBody[dataEnd-1] == '\n' {
				dataEnd--
			}
			if dataEnd > dataStart && rawBody[dataEnd-1] == '\r' {
				dataEnd--
			}
			encStream := rc4Encrypt(objKey, []byte(rawBody[dataStart:dataEnd]))
			var buf bytes.Buffer
			buf.WriteString(dictPart + "stream\n")
			buf.Write(encStream)
			buf.WriteString("\nendstream\n")
			objects[objNum] = pdfObj{gen: genNum, content: buf.Bytes()}
		} else {
			encBody := encryptObjectStrings(rawBody, objKey)
			objects[objNum] = pdfObj{gen: genNum, content: []byte(encBody)}
		}
	}

	encObjNum := maxObjNum + 1
	encDict := fmt.Sprintf("\n<< /Filter /Standard /V 2 /R 3 /Length 128 /P -3904 /O <%s> /U <%s> >>\n",
		strings.ToUpper(hex.EncodeToString(oVal)), strings.ToUpper(hex.EncodeToString(uFull)))
	objects[encObjNum] = pdfObj{gen: 0, content: []byte(encDict)}

	var out bytes.Buffer
	out.Write([]byte("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"))
	totalSize := encObjNum + 1
	xrefEntries := []string{"0000000000 65535 f \n"}

	for num := 1; num < totalSize; num++ {
		obj, ok := objects[num]
		if !ok {
			xrefEntries = append(xrefEntries, "0000000000 65535 f \n")
			continue
		}
		xrefEntries = append(xrefEntries, fmt.Sprintf("%010d %05d n \n", out.Len(), obj.gen))
		fmt.Fprintf(&out, "%d %d obj", num, obj.gen)
		out.Write(obj.content)
		out.WriteString("endobj\n")
	}

	xrefOffset := out.Len()
	fileIDHex := strings.ToUpper(hex.EncodeToString(fileID))
	infoEntry := ""
	if infoRef != "" {
		infoEntry = "/Info " + infoRef + " "
	}
	fmt.Fprintf(&out, "xref\n0 %d\n%s", totalSize, strings.Join(xrefEntries, ""))
	fmt.Fprintf(&out, "trailer\n<< /Size %d /Root %s %s/Encrypt %d 0 R /ID [<%s><%s>] >>\nstartxref\n%d\n%%%%EOF\n",
		totalSize, rootRef, infoEntry, encObjNum, fileIDHex, fileIDHex, xrefOffset)

	return out.Bytes(), nil
}
